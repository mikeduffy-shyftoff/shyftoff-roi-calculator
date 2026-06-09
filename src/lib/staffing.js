import {
  findRequiredAgents,
  findRequiredAgentsByOcc,
  findNaturalMaxOcc,
  serviceLevel,
  findRequiredAgentsErlangA,
  serviceLevelErlangA,
} from "./erlang.js";

// Greedy shift-block solver: replicates the v15 WFM model. Traditional centers
// schedule fixed shifts with staggered starts; agents work the whole shift, so
// schedules over-cover the demand bathtub. Returns per-shift headcount and the
// scheduled coverage staircase that drives the "overstaffed mid-day,
// understaffed at edges" pattern.
export function solveShiftBlocks(
  intervals,
  shiftLengthHrs,
  shrinkage,
  influxTarget = 1.2,
) {
  const n = intervals.length;
  if (n === 0) return { dailyShiftHours: 0, avgFTE: 0 };

  const intervalsPerShift = shiftLengthHrs * 2;
  // 30-min stagger between shift starts. Real WFM platforms (NICE IEX,
  // Verint, Genesys) use 15-30 min granularity — 1-hour stagger creates only
  // 3 shift slots on a 10-hr window, which forces the solver to flat-cover
  // the mid-day overlap and starve the edges. With 30-min stagger we get 5
  // slots (8:00, 8:30, 9:00, 9:30, 10:00 for an 8-12 hr window), giving the
  // squared-deviation solver a tapered coverage gradient to approximate the
  // U-shaped demand curve more honestly.
  const stagger = 1; // 30-min stagger
  const startWindow = Math.max(0, n - intervalsPerShift);
  const numShifts =
    startWindow > 0 ? Math.max(1, Math.floor(startWindow / stagger) + 1) : 1;

  const shiftDefs = [];
  for (let s = 0; s < numShifts; s++) {
    const si = Math.min(s * stagger, Math.max(0, n - intervalsPerShift));
    const ei = Math.min(si + intervalsPerShift, n);
    shiftDefs.push({ startIdx: si, endIdx: ei, hours: (ei - si) * 0.5 });
  }

  // `target` = heads-in-seats target per interval. We schedule BODIES, not
  // on-phones; bodies × (1 - shrinkage) ≈ on-phones, so to deliver `required`
  // on-phones we need to schedule `required / (1 - shrinkage)` heads-in-seats.
  // (The chart's "Required (Erlang C)" line shows raw `iv.required` separately
  // — that's what a real WFM analyst calls the on-phones requirement.)
  const target = intervals.map((iv) =>
    Math.ceil(iv.required / (1 - shrinkage)),
  );
  const totalRequired = target.reduce((s, v) => s + v, 0);
  // adjustedTarget scales the per-interval goal by the user's coverage choice.
  // At influxTarget = 0.90, every interval aims for 90% of its target — the
  // squared-deviation solver then distributes the under-coverage roughly
  // evenly across intervals instead of bunching it at the edges.
  const adjustedTarget = target.map((t) => t * influxTarget);

  const getSched = (agents) => {
    const sched = new Array(n).fill(0);
    shiftDefs.forEach((sh, i) => {
      for (let j = sh.startIdx; j < sh.endIdx; j++) sched[j] += agents[i];
    });
    return sched;
  };

  // Squared-deviation objective: penalize BOTH over- and under-coverage,
  // with bigger gaps hurting quadratically more. The old one-sided gap (which
  // only counted under-coverage) is the textbook EWFM mistake — it makes
  // over-stuffing "free" so the solver loads up the mid-day shift overlap
  // where one agent helps the most intervals, and starves the edges (e.g.
  // 16:00-18:00 covered by only one shift). Squared deviation makes the
  // solver distribute agents so the worst per-interval gap is minimized,
  // matching how a real WFM analyst builds a schedule.
  const getSquaredGap = (sched) => {
    let gap = 0;
    for (let i = 0; i < n; i++) {
      const d = adjustedTarget[i] - sched[i];
      gap += d * d;
    }
    return gap;
  };

  const shiftAgents = new Array(numShifts).fill(0);
  // Safety cap so a pathological input can't loop forever. Set generously to
  // 2× total adjusted target divided by shifts (each agent contributes to
  // multiple intervals, so this is way more than we'd ever actually need).
  const totalAdjusted = adjustedTarget.reduce((s, v) => s + v, 0);
  const safetyCap = Math.ceil(2 * totalAdjusted / Math.max(1, numShifts)) + 50;

  for (let iter = 0; iter < safetyCap; iter++) {
    const cs = getSched(shiftAgents);
    const currentGap = getSquaredGap(cs);
    let bestShift = -1;
    let bestImprovement = 0;
    for (let s = 0; s < numShifts; s++) {
      const trial = [...shiftAgents];
      trial[s]++;
      const newGap = getSquaredGap(getSched(trial));
      const improvement = currentGap - newGap;
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestShift = s;
      }
    }
    // No shift improves squared deviation — we're at a local optimum: every
    // interval either at or past its adjustedTarget, and adding more agents
    // anywhere would strictly increase the over-coverage penalty.
    if (bestShift === -1) break;
    shiftAgents[bestShift]++;
  }

  const scheduledPerInterval = getSched(shiftAgents);

  // Per-shift utilization: on-phones time / paid time. This is the "what
  // you're paying for vs what you're getting" metric — the sales story most
  // BPO buyers respond to. (We considered industry "occupancy" = on_phones /
  // available_for_calls, but reverted because utilization tells the cost
  // story more directly: every percentage point below 100 is paid-but-not-
  // producing time.)
  //
  // Demand share uses AGENT-WEIGHTED routing (each agent has equal call
  // probability), not the old equal-split. Big shifts now get demand
  // proportional to their headcount — matches how real ACDs route calls.
  //
  // Inefficiency hours = paid_time − on_phones_time. Captures shrinkage AND
  // over-coverage. Every active shift always shows > 0 because shrinkage
  // alone is unavoidable.
  const productionFactor = 1 - shrinkage;
  const shiftMetrics = shiftDefs.map((sh, idx) => {
    const agents = shiftAgents[idx];
    if (!agents) return { avgTarget: 0, inefficiencyHrsDay: 0, utilizationPct: 0 };
    let totalActualOnPhones = 0;
    let totalNeededOnPhones = 0;
    let cnt = 0;
    for (let i = sh.startIdx; i < sh.endIdx; i++) {
      const onPhonesDemand = intervals[i].required;
      let totalActiveAgents = 0;
      for (let j = 0; j < shiftDefs.length; j++) {
        const s2 = shiftDefs[j];
        if (i >= s2.startIdx && i < s2.endIdx && shiftAgents[j] > 0) {
          totalActiveAgents += shiftAgents[j];
        }
      }
      const share = totalActiveAgents > 0 ? agents / totalActiveAgents : 0;
      const propOnPhonesDemand = onPhonesDemand * share;
      const onPhonesCapacity = agents * productionFactor;
      const actualOnPhones = Math.min(onPhonesCapacity, propOnPhonesDemand);
      totalActualOnPhones += actualOnPhones;
      totalNeededOnPhones += propOnPhonesDemand;
      cnt++;
    }
    const avgTarget = cnt > 0 ? totalNeededOnPhones / cnt : 0;
    const totalPaidAgentIntervals = agents * (sh.endIdx - sh.startIdx);
    const inefficiencyHrsDay = (totalPaidAgentIntervals - totalActualOnPhones) * 0.5;
    // Utilization (back to v15 semantic): on_phones / paid_time.
    const utilizationPct =
      totalPaidAgentIntervals > 0
        ? Math.min(100, (totalActualOnPhones / totalPaidAgentIntervals) * 100)
        : 0;
    return { avgTarget, inefficiencyHrsDay, utilizationPct };
  });

  const dailyShiftHours = shiftDefs.reduce(
    (s, sh, i) => s + shiftAgents[i] * sh.hours,
    0,
  );
  const avgFTE = dailyShiftHours / shiftLengthHrs;
  return {
    dailyShiftHours,
    avgFTE,
    shiftAgents,
    shiftDefs,
    scheduledPerInterval,
    shiftMetrics,
  };
}

// Smart break-placement model (replaces the v15 static bathtub).
//
// The old model applied a hardcoded shape per shift (lunch dip at the same
// in-shift position for every shift) which made every shift's lunch stack at
// the same wall-clock time. That's not how a real WFM platform works — NICE
// IEX, Verint, and Genesys all run an intraday-break-optimization pass that
// STAGGERS lunches across overlapping shifts so on-phones tracks demand.
//
// Algorithm (per shift, post body-placement):
//   1. budget_S = shiftAgents_S × shiftLen × inCenterShrink
//      (total agent-intervals of break time this shift owes its agents)
//   2. Greedy: place 1 break-agent-interval at a time. Pick the interval
//      (within shift's active window) where current on-phones MOST EXCEEDS
//      required. This naturally puts breaks during overlap valleys / lunch
//      where adjacent shifts can absorb the coverage hit.
//   3. Subject to a 50% cap per interval (no more than half a shift on break
//      at once — keeps the schedule physically realistic).
//   4. If `rawRequired` isn't provided, fall back to a flat target (placing
//      breaks evenly), which is the backward-compat path.
//
// Finally, out-of-center shrinkage (training, PTO, sick) is applied as a
// flat multiplier because those agents aren't on the floor at all.
//
// Backward compatible: with no shrinkage args, returns scheduled as-is.
export function computeOnPhones(
  shiftDefs,
  shiftAgents,
  n,
  inCenterShrink = 0,
  outOfCenterShrink = 0,
  rawRequired = null,
) {
  // Pass 1: scheduled bodies per interval (what the solver placed).
  const scheduled = new Array(n).fill(0);
  shiftDefs.forEach((sh, idx) => {
    const agents = shiftAgents[idx];
    if (!agents) return;
    for (let i = sh.startIdx; i < sh.endIdx; i++) scheduled[i] += agents;
  });

  // If no in-center shrinkage requested, skip the break solver entirely
  // (backward-compat with v15 callers that pre-date the shrinkage params).
  if (inCenterShrink <= 0) {
    return scheduled.map((s) => Math.round(s * (1 - outOfCenterShrink)));
  }

  // Pass 2: smart break placement, one shift at a time.
  const breaks = new Array(n).fill(0);
  // Track per-shift, per-interval break count so we can enforce the cap
  // without double-counting across shifts.
  const breaksPerShift = shiftDefs.map(() => new Array(n).fill(0));

  shiftDefs.forEach((sh, idx) => {
    const agents = shiftAgents[idx];
    if (!agents) return;
    const shiftLen = sh.endIdx - sh.startIdx;
    let budget = Math.round(agents * shiftLen * inCenterShrink);
    // 50% cap: never more than half a shift on break simultaneously. Real
    // WFM ranges from 25% (strict) to 50% (busy lunch rotation).
    let cap = Math.max(1, Math.ceil(agents * 0.50));

    let safety = 0;
    while (budget > 0 && safety < 100000) {
      safety++;
      let bestI = -1;
      let bestImprovement = -Infinity;
      for (let i = sh.startIdx; i < sh.endIdx; i++) {
        if (breaksPerShift[idx][i] >= cap) continue;
        const currentOnPhones = scheduled[i] - breaks[i];
        if (currentOnPhones <= 0) continue;
        // Where would placing 1 more break most help? If on-phones[i] > target[i]
        // (over-staffed), placing a break here HELPS by reducing the squared
        // deviation. If under-staffed, it hurts. Greedy picks the most-helping
        // (or least-hurting) interval. Improvement = 2(op − target) − 1.
        const target = rawRequired && rawRequired[i] != null
          ? rawRequired[i]
          : 0; // no target info → just trim from highest on-phones (flat-down)
        const improvement = 2 * (currentOnPhones - target) - 1;
        if (improvement > bestImprovement) {
          bestImprovement = improvement;
          bestI = i;
        }
      }
      if (bestI === -1) {
        // Every interval at cap. Raise cap and try again.
        if (cap < agents) {
          cap++;
          continue;
        }
        break; // truly nowhere to place; shouldn't happen for sane inputs
      }
      breaksPerShift[idx][bestI]++;
      breaks[bestI]++;
      budget--;
    }
  });

  // On-phones = (scheduled − breaks) × (1 − outOfCenterShrink)
  // The flat out-of-center reduction handles agents who aren't on the floor
  // at all (training, PTO, sick) — those can't be redirected by intraday WFM.
  return scheduled.map((s, i) =>
    Math.round((s - breaks[i]) * (1 - outOfCenterShrink)),
  );
}

// Slices an arrival curve to the active hours and runs Erlang C per interval.
// `arrivalCurve` must be a 48-element array of { label, pct }. Supports
// midnight-wrap schedules (endHour < startHour).
//
// `prioritizeOcc` switches the staffing model from dual-constraint (default,
// returns max(occ_floor, sl_floor)) to occ-only (returns ceil(erlangs/maxOcc)).
// In occ-only mode the SL target is informational — we still compute achievedSL
// per interval so the caller can warn when it drops below the target.
// Deterministic pseudo-random in [-1, 1]. Seeded by interval index so the
// chart is stable across renders (no flicker). Used to add visible
// per-interval variance to the post-AI residual demand curve — vanilla
// CAMEL × volume is too smooth to tell the "AI removes the predictable
// baseload, residual is bursty" story.
function seededNoise(i) {
  const x = Math.sin((i + 1) * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; // [-1, 1)
}

export function computeIntervalStaffing({
  arrivalCurve,
  dailyVolume,
  ahtMins,
  startHour,
  endHour,
  targetSL,
  targetSeconds,
  maxOcc,
  shrinkage,
  prioritizeOcc = false,
  // Amplitude of per-interval call-volume noise (0 = smooth CAMEL × volume).
  // Used for post-AI scenarios where residual demand is bumpier than the
  // pre-AI baseline. scenarios.js auto-derives this from cvUplift so higher
  // containment produces a visibly choppier curve.
  volatilityNoise = 0,
  // Queueing model: "erlangC" (infinite patience, classic) or "erlangA"
  // (exponential abandonment). Erlang A typically requires fewer agents to
  // hit the same SL because impatient callers shorten the queue. beta is the
  // patience ratio θ × AHT (β = AHT / mean patience). beta = 0 is identical
  // to Erlang C for all outputs.
  queueModel = "erlangC",
  beta = 0,
}) {
  const ahtSec = ahtMins * 60;
  const active =
    endHour > startHour
      ? arrivalCurve.slice(startHour * 2, endHour * 2)
      : [
          ...arrivalCurve.slice(startHour * 2),
          ...arrivalCurve.slice(0, endHour * 2),
        ];
  const totalPct = active.reduce((s, i) => s + i.pct, 0);

  let totalRequired = 0;
  let totalScheduled = 0;
  let peak = 0;
  let minAchievedSL = 1;
  // Daily metrics are CALL-VOLUME-WEIGHTED across intervals, not min/max.
  // Industry "daily SL" is calculated as (calls answered in target) / total
  // calls — calls in busy intervals matter more than calls in quiet ones.
  // Taking the MIN per-interval natural lets a Sunday 8 AM interval with 1
  // call dictate the staffing plan for a peak Monday lunch with 100 calls,
  // which is the textbook wrong way to aggregate per-interval Erlang outputs.
  let weightedNaturalNum = 0; // Σ(natural_i × calls_i)
  let weightedSLNum = 0;       // Σ(SL_i × calls_i)
  let weightedCallsDen = 0;    // Σ(calls_i) over intervals with any traffic
  const intervals = active.map((iv, idx) => {
    const norm = iv.pct / totalPct;
    const baseCalls = dailyVolume * norm;
    // Apply seeded volatility noise. Pre-AI scenarios pass 0 and stay
    // smooth. Post-AI scenarios pass a value derived from cvUplift so the
    // residual stream shows visible interval-to-interval variance — which
    // is what actually happens when AI removes the predictable baseload.
    const noiseFactor = volatilityNoise > 0
      ? Math.max(0, 1 + seededNoise(idx) * volatilityNoise)
      : 1;
    const calls = baseCalls * noiseFactor;
    const erlangs = calls * 2 * (ahtSec / 3600);
    const useErlangA = queueModel === "erlangA";
    const req = prioritizeOcc
      ? findRequiredAgentsByOcc(erlangs, maxOcc)
      : useErlangA
        ? findRequiredAgentsErlangA(erlangs, ahtSec, targetSL, targetSeconds, maxOcc, beta)
        : findRequiredAgents(erlangs, ahtSec, targetSL, targetSeconds, maxOcc);
    // Compute the achieved SL at this staffing level. In dual-constraint mode
    // this is always >= targetSL by construction. In occ-only mode it may
    // drop below — that's the warning condition the calculator surfaces.
    const achievedSL =
      erlangs > 0
        ? (useErlangA
            ? serviceLevelErlangA(req, erlangs, beta, ahtSec, targetSeconds)
            : serviceLevel(req, erlangs, ahtSec, targetSeconds))
        : 1;
    if (erlangs > 0) {
      if (achievedSL < minAchievedSL) minAchievedSL = achievedSL;
      // sl_floor with no occ cap = the "pure SL" agent count for this interval.
      const slFloor = useErlangA
        ? findRequiredAgentsErlangA(erlangs, ahtSec, targetSL, targetSeconds, 0.999, beta)
        : findRequiredAgents(erlangs, ahtSec, targetSL, targetSeconds, 0.999);
      const ivUpper = slFloor > 1 ? erlangs / (slFloor - 1) - 1e-9 : 0.95;
      // Accumulate call-weighted contributions. Intervals with more calls
      // dominate; quiet intervals contribute little.
      weightedNaturalNum += ivUpper * calls;
      weightedSLNum += achievedSL * calls;
      weightedCallsDen += calls;
    }
    // Guard against shrinkage = 1.0 (everyone is on break) — caller can land
    // here from a stress-test slider; treat as a tiny epsilon so the schedule
    // is huge-but-finite instead of Infinity.
    const productionFrac = Math.max(0.01, 1 - shrinkage);
    const sched = Math.ceil(req / productionFrac);
    totalRequired += req;
    totalScheduled += sched;
    peak = Math.max(peak, sched);
    return {
      label: iv.label,
      required: req,
      scheduled: sched,
      calls,
      erlangs,
      achievedSL,
    };
  });
  // Call-weighted natural maxOcc. Bounded to a realistic industry range
  // [0.55, 0.95] to defend against pathological inputs (e.g. a zero-call day
  // pinning natural at the fallback default).
  const weightedNatural =
    weightedCallsDen > 0 ? weightedNaturalNum / weightedCallsDen : 0.85;
  const achievedSL =
    weightedCallsDen > 0 ? weightedSLNum / weightedCallsDen : 1;
  const naturalMaxOcc = Math.min(0.95, Math.max(0.55, weightedNatural));

  return {
    intervals,
    totalRequired,
    totalScheduled,
    peak,
    minAchievedSL,
    achievedSL, // call-weighted "daily SL" (industry-standard reporting metric)
    naturalMaxOcc,
    totalCalls: weightedCallsDen, // exposed so scenarios.js can weight across DOW
  };
}
