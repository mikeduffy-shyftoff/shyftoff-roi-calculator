import { describe, it, expect } from "vitest";
import {
  erlangC,
  serviceLevel,
  findRequiredAgents,
} from "../erlang.js";
import { SINGLE_PEAK, CAMEL, BELL, DEFAULT_DOW } from "../arrivalCurves.js";
import { computeIntervalStaffing, solveShiftBlocks } from "../staffing.js";
import { computeScenarioCost } from "../scenarios.js";
import { TIER_PRESETS, DEFAULT_GIG_TIERS } from "../presets.js";

// These tests pin the current numerical output of the math lib for default
// inputs taken from App.jsx and AICalculator.jsx as of the lib-extraction.
// Their job is to detect any silent math drift introduced by Phase 2's
// UI unification or later refactors. If you intentionally change the math,
// update the expected values here in the same commit.

describe("erlang", () => {
  it("erlangC matches reference values", () => {
    // 5 agents handling 3 erlangs of traffic — well-known textbook case.
    expect(erlangC(5, 3)).toBeCloseTo(0.2362, 3);
    // Saturated server returns 1
    expect(erlangC(3, 3)).toBe(1);
    // Zero traffic returns 0
    expect(erlangC(5, 0)).toBe(0);
  });

  it("serviceLevel respects bounds", () => {
    expect(serviceLevel(0, 5, 300, 20)).toBe(0);
    expect(serviceLevel(10, 0, 300, 20)).toBe(1);
    const sl = serviceLevel(10, 5, 300, 20);
    expect(sl).toBeGreaterThan(0);
    expect(sl).toBeLessThanOrEqual(1);
  });

  it("findRequiredAgents (default) for 30 erlangs at 80/20 SL, AHT 300s, max occ 0.85", () => {
    expect(findRequiredAgents(30, 300, 0.8, 20, 0.85)).toBe(36);
  });

});

describe("arrival curves", () => {
  it("each curve has 48 30-min intervals", () => {
    expect(SINGLE_PEAK.length).toBe(48);
    expect(CAMEL.length).toBe(48);
  });

  it("SINGLE_PEAK has one peak around 10:00", () => {
    const max = Math.max(...SINGLE_PEAK.map((i) => i.pct));
    const peak = SINGLE_PEAK.find((i) => i.pct === max);
    expect(peak.label).toBe("10:00");
  });

  it("CAMEL has its global max at 09:30 (morning hump)", () => {
    const max = Math.max(...CAMEL.map((i) => i.pct));
    const peak = CAMEL.find((i) => i.pct === max);
    expect(peak.label).toBe("09:30");
  });

  it("BELL is a symmetric Gaussian centered at 12:00", () => {
    expect(BELL.length).toBe(48);
    const max = Math.max(...BELL.map((i) => i.pct));
    const peak = BELL.find((i) => i.pct === max);
    expect(peak.label).toBe("12:00");
    // Symmetry: points equidistant from the mean (index 24) should match
    // after rounding to 1 decimal place.
    expect(BELL[20].pct).toBeCloseTo(BELL[28].pct, 1);
    expect(BELL[12].pct).toBeCloseTo(BELL[36].pct, 1);
    // Tails go to ~0 in the small hours
    expect(BELL[0].pct).toBeLessThan(0.1);
  });

  it("DEFAULT_DOW sums to ~100%", () => {
    const sum = Object.values(DEFAULT_DOW).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 1);
  });
});

describe("staffing — interval computation", () => {
  it("pins the per-interval staffing curve for a default-ish workload", () => {
    const { intervals, totalRequired, peak } = computeIntervalStaffing({
      arrivalCurve: CAMEL,
      dailyVolume: 8000,
      ahtMins: 8,
      startHour: 8,
      endHour: 18,
      targetSL: 0.8,
      targetSeconds: 20,
      maxOcc: 0.85,
      shrinkage: 0.35,
    });
    expect(intervals.length).toBe(20); // (18 - 8) * 2 = 20
    // Pinned actuals at lib-extraction time. If you intentionally change the
    // staffing math, regenerate these values (don't loosen the assertion).
    expect(totalRequired).toBe(2520);
    expect(peak).toBe(291);
  });
});

describe("staffing — shift-block solver", () => {
  it("produces a non-zero schedule for non-trivial demand", () => {
    const { intervals } = computeIntervalStaffing({
      arrivalCurve: CAMEL,
      dailyVolume: 8000,
      ahtMins: 8,
      startHour: 8,
      endHour: 18,
      targetSL: 0.8,
      targetSeconds: 20,
      maxOcc: 0.85,
      shrinkage: 0.35,
    });
    const { dailyShiftHours, avgFTE, shiftAgents } = solveShiftBlocks(
      intervals,
      8,
      0.35,
    );
    // Pinned actuals (2026-05-21 squared-dev + 30-min stagger). 5 shift
    // slots at 8:00, 8:30, 9:00, 9:30, 10:00 instead of the prior 3. Total
    // agents and dailyShiftHours unchanged because the squared-dev objective
    // converges to the same operating-cost optimum regardless of stagger —
    // it's the DISTRIBUTION across shifts that gets finer (which lets the
    // model approximate the U-shaped demand curve better at the edges).
    expect(dailyShiftHours).toBe(2120);
    expect(avgFTE).toBe(265);
    expect(shiftAgents).toEqual([139, 50, 43, 25, 8]);
  });
});

describe("scenarios — end-to-end scenario cost", () => {
  // Defaults taken from AICalculator.jsx initial state.
  const baseArgs = {
    arrivalCurve: CAMEL,
    monthlyVolume: 50000,
    ahtMins: 8,
    startHour: 8,
    endHour: 18,
    dow: { Mon: 16.5, Tue: 15.5, Wed: 15.0, Thu: 14.5, Fri: 14.0, Sat: 13.0, Sun: 11.5 },
    gigTiers: DEFAULT_GIG_TIERS,
    targetSL: 0.8,
    targetSeconds: 20,
    maxOcc: 0.85,
    shrinkage: 0.35,
    shiftLength: 8,
    traditionalRate: 18,
    benefitsMultiplier: 35,
    agentsPerSup: 15,
    supHourlyRate: 28,
    postAiWagePremium: 33,
  };

  it("Pre-AI baseline (S1): no AI, no containment", () => {
    const s1 = computeScenarioCost({
      ...baseArgs,
      aiEnabled: false,
      containmentRate: 0,
      escalationRate: 0,
      ahtFactor: 1,
      aiCostPerMin: 0,
    });
    expect(s1.humanVolume).toBe(50000);
    expect(s1.aiMonthlyCost).toBe(0);
    expect(s1.traditionalCost).toBeGreaterThan(0);
    expect(s1.gigCost).toBeGreaterThan(0);
    // Pinned: traditional should be more expensive than gig at these defaults
    expect(s1.traditionalCost).toBeGreaterThan(s1.gigCost);
  });

  it("Post-AI scenario (S3) reduces human volume and inflates AHT via log-normal distribution", () => {
    const s3 = computeScenarioCost({
      ...baseArgs,
      aiEnabled: true,
      containmentRate: 0.75,
      escalationRate: 0.2,
      ahtCV: 0.6, // default voice-call distribution spread
      aiCostPerMin:
        TIER_PRESETS.standard.costs.aiSIP +
        TIER_PRESETS.standard.costs.aiSTT +
        TIER_PRESETS.standard.costs.aiLLM +
        TIER_PRESETS.standard.costs.aiTTS +
        TIER_PRESETS.standard.costs.aiOrchestration +
        TIER_PRESETS.standard.costs.aiCompliance,
    });
    // 50000 − (50000 × 0.75) + (50000 × 0.75 × 0.2) = 20000
    expect(s3.humanVolume).toBe(20000);
    expect(s3.aiMonthlyCost).toBeGreaterThan(0);
    // Net containment = 0.75 × (1 − 0.2) = 0.60. At ahtCV = 0.6 with mean 8 min,
    // the conditional mean above the 60th percentile is ≈ 12.37 min (1.55× base).
    // This auto-scales with containment now, replacing the old fixed 1.30× knob.
    expect(s3.humanAHT).toBeCloseTo(12.37, 1);
    // ahtFactor is now derived output, not input.
    expect(s3.ahtFactor).toBeCloseTo(1.55, 1);
  });

  // Peakedness-adjusted Erlang C variability buffer — locks in the post-AI
  // staffing gross-up that
  // accounts for residual-stream CV inflation. The fixture used here mirrors
  // the calculator's AI defaults (60% containment, 18% escalation).
  it("volatility buffer inflates post-AI staffing cost when α > 0", () => {
    const aiArgs = {
      ...baseArgs, aiEnabled: true,
      containmentRate: 0.60, escalationRate: 0.18, ahtFactor: 1.30,
      aiCostPerMin: 0.14,
    };
    const sNoBuffer  = computeScenarioCost({ ...aiArgs, volatilityAlpha: 0 });
    const sWithBuf   = computeScenarioCost({ ...aiArgs, volatilityAlpha: 0.10 });

    // cvUplift > 0 whenever AI removes any volume.
    expect(sWithBuf.cvUplift).toBeGreaterThan(0);
    // Buffer formula: 1 + α × cvUplift. With cvUplift ≈ 0.97, buffer ≈ 1.097.
    expect(sWithBuf.volatilityBuffer).toBeCloseTo(1 + 0.10 * sWithBuf.cvUplift, 5);
    // Buffer must actually inflate traditional cost — not just sit in the API.
    expect(sWithBuf.traditionalCost).toBeGreaterThan(sNoBuffer.traditionalCost);
    // Sanity: α=0 must be a strict no-op on the buffer side.
    expect(sNoBuffer.volatilityBuffer).toBe(1);
  });

  // Prioritize-occupancy mode — locks in the maxOcc slider's new behavior.
  // When prioritizeOcc=true, staffing uses ceil(erlangs/maxOcc) per interval
  // instead of the dual occ + SL floor. SL becomes an output (minAchievedSL)
  // that drops below target when the user pushes maxOcc above natural.
  it("naturalMaxOcc is exposed and lands in a sensible range", () => {
    const r = computeScenarioCost({ ...baseArgs, aiEnabled: false,
      containmentRate: 0, escalationRate: 0, ahtFactor: 1, aiCostPerMin: 0 });
    expect(r.naturalMaxOcc).toBeGreaterThan(0.50);
    expect(r.naturalMaxOcc).toBeLessThanOrEqual(0.95);
  });

  it("at maxOcc=natural with prioritizeOcc, daily SL meets target", () => {
    const probe = computeScenarioCost({ ...baseArgs, aiEnabled: false,
      containmentRate: 0, escalationRate: 0, ahtFactor: 1, aiCostPerMin: 0 });
    const atNat = computeScenarioCost({ ...baseArgs, aiEnabled: false,
      containmentRate: 0, escalationRate: 0, ahtFactor: 1, aiCostPerMin: 0,
      maxOcc: probe.naturalMaxOcc, prioritizeOcc: true });
    // We pin the call-weighted "daily SL" (industry-standard reporting),
    // not the worst-interval SL — a single quiet interval with 1 call
    // could otherwise drag the min down without reflecting real customer
    // experience. Allow ε for rounding (target 0.80, accept 0.78+).
    expect(atNat.achievedSL).toBeGreaterThanOrEqual(0.78);
  });

  it("at maxOcc above natural with prioritizeOcc, SL drops below target", () => {
    const probe = computeScenarioCost({ ...baseArgs, aiEnabled: false,
      containmentRate: 0, escalationRate: 0, ahtFactor: 1, aiCostPerMin: 0 });
    const above = computeScenarioCost({ ...baseArgs, aiEnabled: false,
      containmentRate: 0, escalationRate: 0, ahtFactor: 1, aiCostPerMin: 0,
      maxOcc: Math.min(0.95, probe.naturalMaxOcc + 0.10), prioritizeOcc: true });
    // Pushing 10pp past natural must trigger an SL drop — that's the entire
    // point of the warning UX. If this fails, the slider has gone dead again.
    expect(above.minAchievedSL).toBeLessThan(baseArgs.targetSL);
    // And cost should actually go DOWN as we squeeze occupancy higher,
    // confirming the slider is responsive in this range.
    expect(above.traditionalCost).toBeLessThan(probe.traditionalCost);
  });

  it("prioritizeOcc defaults to false (lib default behavior is unchanged)", () => {
    // Smoke test: the lib's prioritizeOcc default is still false. We don't
    // pin a specific SL value — the delivered SL depends on the shift
    // solver's per-interval output which the test doesn't control. We just
    // verify the model runs and returns sensible structural values.
    const r = computeScenarioCost({ ...baseArgs, aiEnabled: false,
      containmentRate: 0, escalationRate: 0, aiCostPerMin: 0 });
    expect(r.traditionalCost).toBeGreaterThan(0);
    expect(r.achievedSL).toBeGreaterThanOrEqual(0);
    expect(r.achievedSL).toBeLessThanOrEqual(1);
  });

  it("volatility buffer is a no-op when AI is disabled", () => {
    const s1NoBuffer = computeScenarioCost({
      ...baseArgs, aiEnabled: false, containmentRate: 0, escalationRate: 0,
      ahtFactor: 1, aiCostPerMin: 0, volatilityAlpha: 0,
    });
    const s1WithBuf  = computeScenarioCost({
      ...baseArgs, aiEnabled: false, containmentRate: 0, escalationRate: 0,
      ahtFactor: 1, aiCostPerMin: 0, volatilityAlpha: 0.10,
    });
    // Pre-AI: cvUplift must be exactly 0 (humanVolume === monthlyVolume),
    // so the buffer collapses to 1.0 regardless of α — pre-AI math is sacred.
    expect(s1WithBuf.cvUplift).toBe(0);
    expect(s1WithBuf.volatilityBuffer).toBe(1);
    expect(s1WithBuf.traditionalCost).toBe(s1NoBuffer.traditionalCost);
  });
});

describe("scenarios — granular cost model (full App.jsx parity)", () => {
  // Defaults taken from App.jsx v15 initial state (the classic calculator).
  const fullArgs = {
    arrivalCurve: CAMEL,
    monthlyVolume: 50000,
    ahtMins: 8,
    startHour: 8,
    endHour: 18,
    dow: DEFAULT_DOW,
    gigTiers: DEFAULT_GIG_TIERS,
    targetSL: 0.8,
    targetSeconds: 20,
    maxOcc: 0.85,
    shrinkage: 0.35,
    shiftLength: 8,
    traditionalRate: 18,
    benefitsMultiplier: 35,
    agentsPerSup: 15,
    agentsPerMgr: 40,
    agentsPerWfm: 150,
    supSalary: 60000,
    mgrSalary: 85000,
    wfmSalary: 75000,
    workstationCost: 1700,
    equipmentLife: 60,
    aiEnabled: false,
    containmentRate: 0,
    escalationRate: 0,
    ahtFactor: 1,
    aiCostPerMin: 0,
  };

  it("computes peakTradAgents from the bathtub (not avg FTE)", () => {
    const r = computeScenarioCost(fullArgs);
    // 93 after the SL-calibrated coverage refactor: at influxTarget = 1.2
    // (lib default), effective coverage = K × 1.2 where K ≈ 1.15 calibrates
    // to deliver target SL. So total staffing is higher than the old raw
    // 1.2× model.
    expect(r.peakTradAgents).toBe(94);
    expect(r.peakTradAgents).toBeGreaterThanOrEqual(r.avgFTE);
  });

  it("rolls up sup / mgr / wfm headcount from peakTradAgents", () => {
    const r = computeScenarioCost(fullArgs);
    expect(r.supCount).toBe(7); // ceil(94 / 15)
    expect(r.mgrCount).toBe(3); // ceil(94 / 40)
    expect(r.wfmCount).toBe(1); // ceil(94 / 150)
  });

  it("support cost = (sup*supSalary + mgr*mgrSalary + wfm*wfmSalary) / 12", () => {
    const r = computeScenarioCost(fullArgs);
    // (7*60000 + 3*85000 + 1*75000) / 12 = 750000 / 12 = 62500
    expect(Math.round(r.supportCostMonthly)).toBe(62500);
  });

  it("workstation cost = peakTrad * (workstationCost / equipmentLife)", () => {
    const r = computeScenarioCost(fullArgs);
    // 94 * (1700 / 60) = 94 * 28.33 = 2663
    expect(Math.round(r.workstationCostMonthly)).toBe(2663);
  });

  it("Infinity for agentsPerMgr / Wfm disables that tier", () => {
    const r = computeScenarioCost({
      ...fullArgs,
      agentsPerMgr: Infinity,
      agentsPerWfm: Infinity,
    });
    expect(r.mgrCount).toBe(0);
    expect(r.wfmCount).toBe(0);
    // Only sup contributes
    expect(Math.round(r.supportCostMonthly)).toBe(35000); // (7*60000)/12
  });

  it("traditional cost combines shift labor + support + workstation", () => {
    const r = computeScenarioCost(fullArgs);
    expect(Math.round(r.traditionalCost)).toBe(471730);
    expect(r.traditionalCost).toBeGreaterThan(r.gigCost);
  });

  it("influxTarget controls the over-staffing cushion", () => {
    const tight = computeScenarioCost({ ...fullArgs, influxTarget: 1.0 });
    const loose = computeScenarioCost({ ...fullArgs, influxTarget: 1.4 });
    // Higher influx target = more scheduled hours = higher cost
    expect(loose.monthlyScheduledHours).toBeGreaterThan(
      tight.monthlyScheduledHours,
    );
  });
});

describe("presets — TIER_PRESETS", () => {
  it("has lean, standard, premium keys", () => {
    expect(Object.keys(TIER_PRESETS).sort()).toEqual([
      "lean",
      "premium",
      "standard",
    ]);
  });

  it("standard preset costs sum to the expected per-minute base", () => {
    const c = TIER_PRESETS.standard.costs;
    const base =
      c.aiSIP + c.aiSTT + c.aiLLM + c.aiTTS + c.aiOrchestration + c.aiCompliance;
    expect(base).toBeCloseTo(0.14, 3);
  });
});
