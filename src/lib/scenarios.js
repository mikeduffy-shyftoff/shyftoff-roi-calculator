import { computeIntervalStaffing, solveShiftBlocks, computeOnPhones } from "./staffing.js";
import { serviceLevel } from "./erlang.js";
import { lognormalConditionalMean } from "./distribution.js";

const WEEKS_PER_MONTH = 4.33;

// Full DOW-weighted monthly cost for one scenario (Pre/Post AI × Trad/Gig).
// `dow` is { Mon: 16.5, Tue: 15.5, ... } where each value is % of weekly
// volume (0 = closed). Per-DOW Erlang C + shift-block solve, weighted by
// 4.33 weeks/month. Visualization data (intervals, shifts) comes from the
// peak day so the charts always show the worst-case staffing pattern.
//
// Cost model (canonical, ported from the v15 calculator):
//   sup/mgr/wfm headcount = ceil(peakTradAgents / ratio), min 1 when ratio is finite.
//   support cost (monthly) = (supCount*supSalary + mgrCount*mgrSalary + wfmCount*wfmSalary) / 12
//   workstation cost (monthly) = peakTradAgents * (workstationCost / equipmentLife)
//   traditional cost = scheduledHours*loadedRate + support + workstation
// To disable a support tier, pass agentsPerMgr/Wfm = Infinity.
export function computeScenarioCost({
  arrivalCurve,
  monthlyVolume,
  ahtMins,
  startHour,
  endHour,
  dow,
  gigTiers,
  targetSL,
  targetSeconds,
  maxOcc,
  shrinkage,
  shiftLength,
  influxTarget = 1.2,
  traditionalRate,
  benefitsMultiplier,
  agentsPerSup,
  agentsPerMgr = Infinity,
  agentsPerWfm = Infinity,
  supSalary = 0,
  mgrSalary = 0,
  wfmSalary = 0,
  workstationCost = 1700,
  equipmentLife = 60,
  aiEnabled,
  containmentRate,
  escalationRate,
  // AHT inflation is now derived from a log-normal distribution model
  // rather than a fixed multiplier. `ahtCV` is the coefficient of variation
  // (σ/μ) of the call-duration distribution; AI removes the bottom portion
  // (easy calls) and the residual mean shifts up automatically. Default
  // 0.6 matches industry voice-call spread. The legacy `ahtFactor` knob is
  // gone — too crude, didn't auto-adjust with containment.
  ahtCV = 0.6,
  aiCostPerMin,
  postAiWagePremium = 0,
  // Peakedness-style variability buffer for the residual human arrival stream.
  // When AI removes the predictable baseload, the same absolute σ over a
  // smaller μ means coefficient of variation rises by ~ monthlyVolume /
  // humanVolume. Vanilla Erlang C assumes Poisson arrivals (peakedness z = 1)
  // and under-staffs in this regime. We gross dailyVol up by α × CV-uplift
  // before Erlang C runs, which forces the solver to schedule a real-world
  // buffer for that volatility. This is a simplified linear approximation in
  // the spirit of Hayward's overflow-traffic approximation (1952) and the
  // peakedness-based staffing rules in Schrieck, Akşin & Chevalier, POMS 2014
  // — it's NOT a precise Hayward implementation. α = 0.10 is a moderate
  // calibration to industry CV data; set α = 0 to recover pure Erlang C
  // (Poisson-arrival) behavior. No effect on pre-AI scenarios because
  // cvUplift = 0 when humanVolume = monthlyVolume.
  volatilityAlpha = 0.10,
  // When true, staffing uses occupancy as the binding constraint (ceil(erlangs/
  // maxOcc)) instead of the dual occ + SL floor. SL becomes an output metric
  // (minAchievedSL) that the caller can compare to targetSL and surface as a
  // warning. The calculator passes true and auto-positions its maxOcc slider
  // at naturalMaxOcc (the sweet spot where SL just meets target).
  prioritizeOcc = false,
}) {
  const contained = aiEnabled ? monthlyVolume * containmentRate : 0;
  const escalated = aiEnabled ? contained * escalationRate : 0;
  const humanVolume = monthlyVolume - contained + escalated;
  // Residual AHT after AI removes the easy/short calls from the bottom of
  // the log-normal distribution. Cutoff = NET containment (calls actually
  // resolved by AI = contained × (1 − escalation)); escalated calls bounce
  // back to humans and re-enter the residual mix. The conditional mean of
  // what remains above the cutoff is the new human AHT.
  const netContainment = aiEnabled
    ? containmentRate * (1 - escalationRate)
    : 0;
  const humanAHT = aiEnabled
    ? lognormalConditionalMean(ahtMins, ahtCV, netContainment)
    : ahtMins;
  // Derived AHT factor (output, for the UI to display). Was the old input.
  const ahtFactor = ahtMins > 0 ? humanAHT / ahtMins : 1;

  const cvUplift = humanVolume > 0 ? Math.max(0, monthlyVolume / humanVolume - 1) : 0;
  const volatilityBuffer = 1 + volatilityAlpha * cvUplift;
  // Visual per-interval noise on the residual demand curve. Auto-scales with
  // cvUplift and caps at ±30% so the chart can't go fully chaotic. Pre-AI
  // scenarios (cvUplift = 0) stay smooth. Post-AI at default 60% containment
  // (cvUplift ≈ 1.5) gets ±30%, which is the visual story we need to show
  // why even a perfectly tuned WFM team can't tame the residual stream.
  const volatilityNoise = aiEnabled ? Math.min(0.30, cvUplift * 0.20) : 0;

  const aiHandledCalls = contained - escalated;
  const aiMonthlyCost = aiHandledCalls * ahtMins * aiCostPerMin;

  const effectiveRate = aiEnabled
    ? traditionalRate * (1 + postAiWagePremium / 100)
    : traditionalRate;
  const loadedRate = effectiveRate * (1 + benefitsMultiplier / 100);

  const dowEntries = Object.entries(dow);
  const dowTotal = dowEntries.reduce((s, [, v]) => s + v, 0);
  const weeklyHumanVolume = humanVolume / WEEKS_PER_MONTH;

  let monthlyGigHours = 0;
  let monthlyShiftHours = 0;
  let peakDayVolume = 0;
  let peakIntervals = null;
  let peakShiftData = null;
  let peakAvgFTE = 0;
  let peakTradAgents = 0;
  let minAchievedSL = 1;
  // Call-weighted aggregation across DOW. Industry "daily SL" is calls-in-
  // target / total-calls — busy days dominate. Taking MIN across DOW lets a
  // quiet Sunday set the model for a peak Monday, which is the textbook
  // wrong way to aggregate.
  let dowWeightedNaturalNum = 0;
  let dowWeightedSLNum = 0;
  let dowWeightedCallsDen = 0;

  // Calibration: find the geometry-buffer multiplier K such that solver
  // delivers target SL at coverage = 1.0 *when maxOcc is at its natural
  // value*. We DO NOT recompute K when the user changes maxOcc — that would
  // make the model auto-compensate for maxOcc changes and the slider would
  // do nothing to SL. K should be a "shift geometry inefficiency" constant
  // that depends on the demand curve and shift menu, not the occupancy
  // ceiling.
  //
  // So when the user moves maxOcc above natural, intervals[i].required drops
  // (Erlang C lets agents run hotter) → solver staffs less at the same K →
  // delivered SL drops. When user moves maxOcc below natural, more required
  // → solver staffs more → SL exceeds target. The Coverage Target slider
  // then layers on top: 1.00 = baseline (calibrated), <1 = save cost / miss
  // SL, >1 = over-provision.
  let calibrationK = 1.0;
  const ahtSec = humanAHT * 60;
  const inCenter = shrinkage * 0.60;
  const outOfCenter = shrinkage * 0.40;
  if (dowEntries.length > 0) {
    const peakEntry = dowEntries.reduce(
      (max, e) => (e[1] > max[1] ? e : max),
      ["", 0],
    );
    if (peakEntry[1] > 0) {
      const peakDailyVol = weeklyHumanVolume * (peakEntry[1] / dowTotal);
      const peakStaffingVol = peakDailyVol * volatilityBuffer;
      // Step 1: discover the workload's natural maxOcc by running staffing
      // with no occ cap (maxOcc=0.99). naturalMaxOcc is purely a function of
      // the demand curve + SL target + AHT, NOT the user's maxOcc input.
      const { naturalMaxOcc: refNatural } = computeIntervalStaffing({
        arrivalCurve,
        dailyVolume: peakStaffingVol,
        ahtMins: humanAHT,
        startHour,
        endHour,
        targetSL,
        targetSeconds,
        maxOcc: 0.99,
        shrinkage,
        prioritizeOcc,
        volatilityNoise,
      });
      // Step 2: compute calibration intervals at maxOcc = refNatural. The K
      // we find here is the geometry buffer relative to "SL-meeting" staffing.
      const { intervals: cIntervals } = computeIntervalStaffing({
        arrivalCurve,
        dailyVolume: peakStaffingVol,
        ahtMins: humanAHT,
        startHour,
        endHour,
        targetSL,
        targetSeconds,
        maxOcc: refNatural,
        shrinkage,
        prioritizeOcc,
        volatilityNoise,
      });
      const cRequired = cIntervals.map((iv) => iv.required);
      let lo = 0.5;
      let hi = 2.5;
      for (let it = 0; it < 12; it++) {
        const mid = (lo + hi) / 2;
        const r = solveShiftBlocks(cIntervals, shiftLength, shrinkage, mid);
        const op = computeOnPhones(
          r.shiftDefs,
          r.shiftAgents,
          cIntervals.length,
          inCenter,
          outOfCenter,
          cRequired,
        );
        let slSum = 0;
        let cSum = 0;
        for (let j = 0; j < cIntervals.length; j++) {
          const iv = cIntervals[j];
          if (iv.calls <= 0 || iv.erlangs <= 0) continue;
          const sl =
            op[j] > 0
              ? serviceLevel(op[j], iv.erlangs, ahtSec, targetSeconds)
              : 0;
          slSum += sl * iv.calls;
          cSum += iv.calls;
        }
        const ds = cSum > 0 ? slSum / cSum : 1;
        if (ds >= targetSL) hi = mid;
        else lo = mid;
      }
      calibrationK = (lo + hi) / 2;
    }
  }
  const effectiveCoverage = calibrationK * influxTarget;

  for (const [, pct] of dowEntries) {
    if (pct <= 0) continue;
    const dailyVol = weeklyHumanVolume * (pct / dowTotal);
    // Peakedness-style buffer: inflate the volume Erlang C sees so it
    // schedules for the residual stream's higher CV. Equivalent to "pretend
    // traffic is buffer× larger for staffing purposes only." Gig and trad
    // both pay the buffer because both feed off the same Erlang C requirement.
    const stafingVol = dailyVol * volatilityBuffer;

    const {
      intervals,
      totalRequired,
      minAchievedSL: dayMinSL,
      achievedSL: dayAchievedSL,
      naturalMaxOcc: dayNaturalMaxOcc,
      totalCalls: dayCalls,
    } = computeIntervalStaffing({
      arrivalCurve,
      dailyVolume: stafingVol,
      ahtMins: humanAHT,
      startHour,
      endHour,
      targetSL,
      targetSeconds,
      maxOcc,
      shrinkage,
      prioritizeOcc,
      volatilityNoise,
    });
    const {
      dailyShiftHours,
      avgFTE,
      shiftAgents,
      shiftDefs,
      scheduledPerInterval,
      shiftMetrics,
    } = solveShiftBlocks(intervals, shiftLength, shrinkage, effectiveCoverage);

    // DELIVERED SL — recompute SL using what the shift solver actually
    // staffed AFTER smart break placement (lunches concentrated during
    // overlap valleys, so on-phones stays high at peaks). This makes the
    // Coverage Target slider affect the SL display correctly:
    //   • 100% coverage → on-phones ≈ Erlang C req at peaks → SL hits target
    //   • 95%  coverage → fewer scheduled bodies → on-phones drops at peaks
    //                     → SL drops below target → warning fires
    //
    // We assume a 60/40 split of total shrinkage into in-center vs out-of-
    // center (matches the calculator's 21/14 default). The 60% is placed
    // via the break-placement optimizer; the 40% is a flat reduction
    // (training/PTO/sick — not on the floor).
    // inCenter / outOfCenter / ahtSec declared at function scope above.
    const dayOnPhones = computeOnPhones(
      shiftDefs,
      shiftAgents,
      intervals.length,
      inCenter,
      outOfCenter,
      intervals.map((iv) => iv.required),
    );
    let dayDeliveredSLNum = 0;
    let dayDeliveredCalls = 0;
    let dayDeliveredMinSL = 1;
    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      if (iv.calls <= 0 || iv.erlangs <= 0) continue;
      const effOnPhones = dayOnPhones[i] || 0;
      const sl = effOnPhones > 0
        ? serviceLevel(effOnPhones, iv.erlangs, ahtSec, targetSeconds)
        : 0;
      dayDeliveredSLNum += sl * iv.calls;
      dayDeliveredCalls += iv.calls;
      if (sl < dayDeliveredMinSL) dayDeliveredMinSL = sl;
    }
    const dayDeliveredSL =
      dayDeliveredCalls > 0 ? dayDeliveredSLNum / dayDeliveredCalls : 1;

    if (dayDeliveredMinSL < minAchievedSL) minAchievedSL = dayDeliveredMinSL;
    if (dayCalls > 0) {
      dowWeightedNaturalNum += dayNaturalMaxOcc * dayCalls;
      dowWeightedSLNum += dayDeliveredSL * dayCalls;
      dowWeightedCallsDen += dayCalls;
    }

    monthlyGigHours += totalRequired * 0.5 * WEEKS_PER_MONTH;
    monthlyShiftHours += dailyShiftHours * WEEKS_PER_MONTH;

    // Peak concurrent headcount across the bathtub — used for sup/mgr/wfm
    // ratios and workstation seat count (you need enough desks for the
    // busiest interval, not the average).
    const dayPeakTrad = scheduledPerInterval.length
      ? Math.max(...scheduledPerInterval)
      : 0;
    if (dayPeakTrad > peakTradAgents) peakTradAgents = dayPeakTrad;

    if (dailyVol > peakDayVolume) {
      peakDayVolume = dailyVol;
      peakIntervals = intervals;
      peakAvgFTE = avgFTE;
      peakShiftData = {
        shiftAgents,
        shiftDefs,
        scheduledPerInterval,
        shiftMetrics,
      };
    }
  }

  // Finalize call-weighted aggregates across DOW.
  const naturalMaxOcc =
    dowWeightedCallsDen > 0
      ? Math.min(0.95, Math.max(0.55, dowWeightedNaturalNum / dowWeightedCallsDen))
      : 0.85;
  const achievedSL =
    dowWeightedCallsDen > 0 ? dowWeightedSLNum / dowWeightedCallsDen : 1;

  const weeklyGigHours = monthlyGigHours / WEEKS_PER_MONTH;
  const sortedTiers = [...gigTiers].sort((a, b) => b.minHours - a.minHours);
  const activeTier =
    sortedTiers.find((t) => weeklyGigHours >= t.minHours) ||
    sortedTiers[sortedTiers.length - 1];
  const gigRate = activeTier.rate;

  const gigCost = monthlyGigHours * gigRate;

  const openDaysPerWeek = dowEntries.filter(([, v]) => v > 0).length;
  const workDaysPerMonth = openDaysPerWeek * WEEKS_PER_MONTH;

  const supCount = Number.isFinite(agentsPerSup)
    ? Math.max(1, Math.ceil(peakTradAgents / agentsPerSup))
    : 0;
  const mgrCount = Number.isFinite(agentsPerMgr)
    ? Math.max(1, Math.ceil(peakTradAgents / agentsPerMgr))
    : 0;
  const wfmCount = Number.isFinite(agentsPerWfm)
    ? Math.max(1, Math.ceil(peakTradAgents / agentsPerWfm))
    : 0;
  const supportCostMonthly =
    (supCount * supSalary + mgrCount * mgrSalary + wfmCount * wfmSalary) / 12;
  const workstationCostMonthly =
    peakTradAgents * (workstationCost / Math.max(1, equipmentLife));
  const traditionalCost =
    monthlyShiftHours * loadedRate + supportCostMonthly + workstationCostMonthly;

  const vols = (peakIntervals || []).map((iv) => iv.calls);
  const mean = vols.reduce((s, v) => s + v, 0) / (vols.length || 1);
  const variance =
    vols.reduce((s, v) => s + (v - mean) ** 2, 0) / (vols.length || 1);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  return {
    humanVolume,
    humanAHT,
    ahtFactor, // derived multiplier (humanAHT / base ahtMins) — for UI display
    aiMonthlyCost,
    aiHandledCalls,
    cvUplift,
    volatilityBuffer,
    minAchievedSL, // worst-case SL across intervals (kept for diagnostics)
    achievedSL,    // call-weighted "daily SL" — the industry-standard reporting number
    naturalMaxOcc,
    monthlyRequiredHours: monthlyGigHours,
    monthlyScheduledHours: monthlyShiftHours,
    avgFTE: peakAvgFTE,
    peakTradAgents,
    supCount,
    mgrCount,
    wfmCount,
    supportCostMonthly,
    workstationCostMonthly,
    traditionalCost,
    gigCost,
    gigRate,
    activeTierLabel: activeTier.label,
    weeklyGigHours,
    workDaysPerMonth,
    traditionalTotal: traditionalCost + aiMonthlyCost,
    gigTotal: gigCost + aiMonthlyCost,
    cv,
    intervals: peakIntervals || [],
    loadedRate,
    ...(peakShiftData || {}),
  };
}
