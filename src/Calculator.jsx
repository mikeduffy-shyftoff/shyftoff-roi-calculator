import { useState, useMemo, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, AreaChart, Area, ReferenceLine, Cell, LabelList,
} from "recharts";
import { CAMEL, SINGLE_PEAK, BELL, DEFAULT_DOW } from "./lib/arrivalCurves.js";

const ARRIVAL_PRESETS = {
  bell: { label: "Bell", curve: BELL, hint: "Gaussian / midday peak" },
  "single-peak": { label: "Single-Peak", curve: SINGLE_PEAK, hint: "Realistic late-morning peak" },
  camel: { label: "Camel", curve: CAMEL, hint: "Dual-peak with lunch valley" },
};
import { fmt, fmtD, fmtCur, fmtCurD } from "./lib/format.js";
import { computeOnPhones } from "./lib/staffing.js";
import { computeScenarioCost } from "./lib/scenarios.js";
import { TIER_PRESETS } from "./lib/presets.js";


// ─── UI Helpers ───────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: "#13141a", border: "1px solid #1e1f2e", borderRadius: 12,
      padding: "20px 24px", ...style,
    }}>{children}</div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
      textTransform: "uppercase", color: "#a855f7", marginBottom: 12, marginTop: 4 }}>
      {children}
    </div>
  );
}

// Hover/focus-triggered info tooltip. Anchored from the icon's left edge
// extending right, so it stays inside the inputs panel regardless of where
// the term sits on the row. Keyboard-accessible via tabIndex + onFocus.
// Named InfoTip to avoid collision with Recharts' Tooltip import.
function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 6 }}>
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        aria-label="Definition"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 13, height: 13, borderRadius: "50%",
          border: "1px solid #4a4855", color: "#8a8891", fontSize: 9, fontWeight: 700,
          cursor: "help", fontFamily: "'DM Sans', sans-serif", userSelect: "none",
          lineHeight: 1, paddingBottom: 1, background: "#0a0b0f",
        }}
      >?</span>
      {open && (
        <div role="tooltip" style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: 0,
          width: 240, padding: "10px 12px",
          background: "#0d0e14", border: "1px solid #a855f7", borderRadius: 8,
          fontSize: 11, lineHeight: 1.5, color: "#c0bec9", fontWeight: 400,
          fontFamily: "'DM Sans', sans-serif", textAlign: "left",
          textTransform: "none", letterSpacing: 0,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)", zIndex: 100,
          pointerEvents: "none",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

function InputRow({ label, children, hint, tooltip }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <label style={{ fontSize: 12, color: "#8a8891", fontWeight: 500, display: "inline-flex", alignItems: "center" }}>
          {label}
          {tooltip && <InfoTip text={tooltip} />}
        </label>
        {hint && <span style={{ fontSize: 10, color: "#4a4855" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min = 0, max, step = 1, prefix, suffix }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {prefix && <span style={{ fontSize: 12, color: "#6b6878" }}>{prefix}</span>}
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          flex: 1, background: "#0d0e14", border: "1px solid #2a2b3d",
          borderRadius: 6, color: "#e2e0e7", padding: "7px 10px", fontSize: 13,
          fontFamily: "'Space Mono', monospace", outline: "none", width: "100%",
        }}
      />
      {suffix && <span style={{ fontSize: 12, color: "#6b6878", minWidth: 28 }}>{suffix}</span>}
    </div>
  );
}

function Slider({ value, onChange, min, max, step = 1, color = "#a855f7" }) {
  return (
    <input type="range" value={value} min={min} max={max} step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ width: "100%", accentColor: color, cursor: "pointer", height: 4 }}
    />
  );
}

// Format an integer hour (0–24) as a readable 12-hour clock label.
// 0 → "12:00 AM (midnight)", 12 → "12:00 PM (noon)", 24 → "12:00 AM (next day)"
function formatHourLabel(h) {
  if (h === 0) return "12:00 AM (midnight)";
  if (h === 12) return "12:00 PM (noon)";
  if (h === 24) return "12:00 AM (next day)";
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

// Time-of-day dropdown. Stores an integer hour in state (0–24) so the math
// layer in scenarios.js / staffing.js — which slices the 48-bucket arrival
// curve at hour*2 — is unchanged. If we ever want half-hour granularity,
// switch the option list to multiples of 0.5 and floor inside the slice call.
function TimeSelect({ value, onChange, min = 0, max = 24 }) {
  const options = [];
  for (let h = min; h <= max; h++) options.push(h);
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      style={{
        width: "100%", background: "#0d0e14", border: "1px solid #2a2b3d",
        borderRadius: 6, color: "#e2e0e7", padding: "7px 10px", fontSize: 13,
        fontFamily: "'Space Mono', monospace", outline: "none",
        cursor: "pointer", appearance: "none",
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%236b6878' d='M0 0l5 6 5-6z'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        paddingRight: 28,
      }}
    >
      {options.map((h) => (
        <option key={h} value={h}>{formatHourLabel(h)}</option>
      ))}
    </select>
  );
}

function ScenarioCard({ label, cost, delta, deltaLabel, color, highlight, tag }) {
  const isWinner = highlight === "winner";
  const isDanger = highlight === "danger";
  return (
    <div style={{
      background: isWinner ? "linear-gradient(135deg, #1a1228 0%, #160d24 100%)"
        : isDanger ? "linear-gradient(135deg, #1a100e 0%, #140b0a 100%)"
        : "#13141a",
      border: `1px solid ${isWinner ? "#a855f7" : isDanger ? "#ef4444" : "#1e1f2e"}`,
      borderRadius: 12, padding: "20px 20px 16px", position: "relative",
      boxShadow: isWinner ? "0 0 24px rgba(168,85,247,0.15)" : "none",
    }}>
      {tag && (
        <div style={{
          position: "absolute", top: -1, right: 12,
          background: isWinner ? "#a855f7" : "#ef4444",
          color: "#fff", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", padding: "3px 8px", borderRadius: "0 0 6px 6px",
        }}>{tag}</div>
      )}
      <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
        {fmtCur(cost)}
      </div>
      <div style={{ fontSize: 11, color: "#4a4855", marginTop: 2 }}>per month</div>
      {delta !== undefined && (
        <div style={{
          marginTop: 10, fontSize: 12, fontWeight: 600,
          color: delta < 0 ? "#22c55e" : delta > 0 ? "#ef4444" : "#6b6878",
        }}>
          {delta < 0 ? "▼ " : delta > 0 ? "▲ " : ""}
          {delta < 0 ? `${fmtCur(Math.abs(delta))} saved` : delta > 0 ? `${fmtCur(delta)} more` : "baseline"}
          {deltaLabel && <span style={{ color: "#4a4855", fontWeight: 400 }}> {deltaLabel}</span>}
        </div>
      )}
    </div>
  );
}

// Custom bar label
function BarLabel({ x, y, width, value, formatter }) {
  if (!value) return null;
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle"
      fill="#8a8891" fontSize={10} fontFamily="Space Mono,monospace">
      {formatter ? formatter(value) : value}
    </text>
  );
}


// ─── Main Component ───────────────────────────────────────────────────────────
export default function Calculator() {
  // Classic (2-scenario) view is the default; toggle expands to the 4-scenario AI view.
  const [showAI, setShowAI] = useState(false);
  const [arrivalKey, setArrivalKey] = useState("camel");
  const [activeTab, setActiveTab] = useState("scenarios");
  const [selectedTier, setSelectedTier] = useState("standard");
  // Simple = exec-friendly headline view (4 inputs + savings hero).
  // Detailed = full model surface (current UI). Default Simple so
  // demo audiences see the answer before they see the assumptions.
  const [mode, setMode] = useState("simple");
  // Detailed view: light inputs (volume, AHT, hours, SL, agent rate) are
  // always visible; advanced (shrinkage, ratios, salaries, etc.) hides
  // behind a + Show advanced expander. Defaults defaults closed so the
  // first impression isn't a wall of 20 fields.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inputs, setInputs] = useState(() => {
    // Compute the "natural" maxOcc for the default workload once at mount.
    // This is the highest occupancy at which minAchievedSL still meets the
    // SL target — the sweet spot where the slider sits at the edge of the
    // no-warning zone. User can drag the slider freely after this; the
    // "↻ reset to natural" button next to the slider re-snaps if their other
    // inputs have drifted the natural elsewhere.
    const naturalProbe = computeScenarioCost({
      arrivalCurve: CAMEL, monthlyVolume: 50000, ahtMins: 8,
      startHour: 8, endHour: 18, dow: DEFAULT_DOW,
      gigTiers: [{ minHours: 0, rate: 31, label: "" }],
      targetSL: 0.80, targetSeconds: 20, maxOcc: 0.85, shrinkage: 0.35,
      shiftLength: 8, influxTarget: 1.2,
      traditionalRate: 18, benefitsMultiplier: 35,
      agentsPerSup: 15, agentsPerMgr: 40, agentsPerWfm: 150,
      supSalary: 60000, mgrSalary: 85000, wfmSalary: 75000,
      workstationCost: 1700, equipmentLife: 60,
      aiEnabled: false, containmentRate: 0, escalationRate: 0,
      ahtFactor: 1, aiCostPerMin: 0, prioritizeOcc: true,
    });
    const naturalPct = Math.round(naturalProbe.naturalMaxOcc * 100);
    return {
    monthlyVolume: 50000,
    aht: 8,
    startHour: 8,
    endHour: 18,
    inCenterShrink: 21,    // breaks, lunch, coaching, system downtime (agent present, off-phones)
    outOfCenterShrink: 14, // training, vacation, sick/FMLA (agent absent from floor)
    serviceLevelTarget: 80,
    serviceLevelThreshold: 20,
    maxOccupancy: naturalPct,
    traditionalRate: 18,
    benefitsMultiplier: 35,
    shiftLength: 8,
    // Coverage Target: SL-calibrated. 1.00 = "schedule enough to hit target
    // SL given shift-block geometry." Lower = save cost, miss SL. Higher =
    // over-provision. Slider range 70-150 covers lean to padded extremes.
    influxTarget: 100,
    // Granular cost model (ported from v15 App.jsx)
    agentsPerSup: 15,
    agentsPerMgr: 40,
    agentsPerWfm: 150,
    supSalary: 60000,
    mgrSalary: 85000,
    wfmSalary: 75000,
    workstationCost: 1700,
    equipmentLife: 60,
    // AI defaults tuned to industry reality (Gartner Dec 2025 survey).
    // Initial value matches the default-selected Standard tier (52.5%).
    // Tier presets snap this to Lean 32.5% / Standard 52.5% / Human-like 72.5%
    // when picked; slider stays adjustable from 25–95%. 18% escalation sits
    // inside the 15–25% industry band.
    containmentRate: 0.525,
    escalationRate: 0.18,
    postAiWagePremium: 28,
    // DOW distribution — % of weekly volume per day (0 = closed)
    // Industry-realistic DOW (FlyFone: Mon +40% over Fri; weekends drop sharply).
    // Update both here AND in arrivalCurves.js DEFAULT_DOW.
    dowMon: 20, dowTue: 17, dowWed: 16, dowThu: 16,
    dowFri: 14, dowSat: 9, dowSun: 8,
    // AI cost stack — Standard Production defaults
    ...TIER_PRESETS.standard.costs,
    };
  });

  // ShyftOff rate: flat $35/hr loaded, no AI-tier or volume adjustment.
  // useState retained (rather than a const) so future tiered pricing can be
  // restored without rewiring; setGigTiers is intentionally unused for now.
  const [gigTiers] = useState([
    { minHours: 0, rate: 35.0, label: "ShyftOff Standard" },
  ]);

  const set = useCallback((key, val) => {
    setInputs((p) => ({ ...p, [key]: val }));
    // If user manually edits any AI cost field, clear the tier selection
    if (["aiSIP","aiSTT","aiLLM","aiTTS","aiOrchestration","aiCompliance","aiFailureBuffer"].includes(key)) {
      setSelectedTier("custom");
    }
  }, []);

  const applyPreset = useCallback((tierKey) => {
    setSelectedTier(tierKey);
    const preset = TIER_PRESETS[tierKey];
    setInputs((p) => ({
      ...p,
      ...preset.costs,
      // Snap containment to the tier's midpoint. Slider stays adjustable
      // after — user can drag it anywhere within min/max.
      ...(preset.defaultContainment != null
        ? { containmentRate: preset.defaultContainment }
        : {}),
    }));
  }, []);

  // ─── Core Math ─────────────────────────────────────────────────────────────
  const arrivalCurve = ARRIVAL_PRESETS[arrivalKey].curve;
  const results = useMemo(() => {
    const {
      monthlyVolume, aht, startHour, endHour,
      inCenterShrink, outOfCenterShrink, serviceLevelTarget, serviceLevelThreshold, maxOccupancy,
      traditionalRate, benefitsMultiplier, shiftLength, influxTarget,
      agentsPerSup, agentsPerMgr, agentsPerWfm,
      supSalary, mgrSalary, wfmSalary,
      workstationCost, equipmentLife,
      containmentRate, escalationRate, postAiWagePremium,
      dowMon, dowTue, dowWed, dowThu, dowFri, dowSat, dowSun,
      aiSIP, aiSTT, aiLLM, aiTTS, aiOrchestration, aiCompliance, aiFailureBuffer,
    } = inputs;

    const targetSL = serviceLevelTarget / 100;
    const maxOcc = maxOccupancy / 100;
    const shrink = (inCenterShrink + outOfCenterShrink) / 100;

    const aiCostBase = aiSIP + aiSTT + aiLLM + aiTTS + aiOrchestration + aiCompliance;
    const aiCostPerMin = aiCostBase * (1 + aiFailureBuffer / 100);

    // Build DOW object — each entry is % of weekly volume (0 = closed)
    const dow = { Mon: dowMon, Tue: dowTue, Wed: dowWed, Thu: dowThu,
                  Fri: dowFri, Sat: dowSat, Sun: dowSun };

    const shared = {
      arrivalCurve,
      startHour, endHour, dow, gigTiers, targetSL,
      targetSeconds: serviceLevelThreshold, maxOcc, shrinkage: shrink,
      traditionalRate, benefitsMultiplier, shiftLength,
      influxTarget: influxTarget / 100,
      agentsPerSup, agentsPerMgr, agentsPerWfm,
      supSalary, mgrSalary, wfmSalary,
      workstationCost, equipmentLife,
      // AHT distribution CV hardcoded to 0.6 (industry voice-call default).
      // Was a user slider; locked per Round 1 spec.
      aiCostPerMin, postAiWagePremium, ahtCV: 0.6,
      // Make the maxOcc slider responsive across its full range. When the user
      // pushes occ above the SL-feasible plateau, staffing transitions to
      // pure-occ-driven and SL drops — surfaced as a warning. Defaults to
      // naturalMaxOcc on first mount (see below) so out-of-the-box the slider
      // sits at "highest occ that still meets SL."
      prioritizeOcc: true,
    };

    // S1: Pre-AI Traditional (baseline). aiEnabled=false → ahtCV is ignored
    // inside the lib (humanAHT just = ahtMins).
    const s1 = computeScenarioCost({ ...shared, monthlyVolume, ahtMins: aht,
      aiEnabled: false, containmentRate: 0, escalationRate: 0 });

    // S2: Pre-AI ShyftOff
    const s2 = computeScenarioCost({ ...shared, monthlyVolume, ahtMins: aht,
      aiEnabled: false, containmentRate: 0, escalationRate: 0 });

    // S3: Post-AI + Traditional — humanAHT now auto-derived from
    // log-normal distribution and the net containment cutoff.
    const s3 = computeScenarioCost({ ...shared, monthlyVolume, ahtMins: aht,
      aiEnabled: true, containmentRate, escalationRate });

    // S4: Post-AI + ShyftOff (winner)
    const s4 = computeScenarioCost({ ...shared, monthlyVolume, ahtMins: aht,
      aiEnabled: true, containmentRate, escalationRate });

    // Costs per scenario
    const preTraditional = s1.traditionalCost;
    const preGig = s2.gigCost;
    const postTraditional = s3.traditionalTotal;
    const postGig = s4.gigTotal;

    // Demand volatility: the KEY insight.
    // When AI removes the predictable baseload, the mean call volume drops dramatically
    // but the absolute standard deviation of arrivals stays roughly constant (randomness
    // doesn't disappear — it just becomes a larger fraction of a smaller mean).
    // CV_post = same_σ / smaller_μ = CV_pre × (total_volume / residual_human_volume)
    const cvMultiplier = s3.humanVolume > 0 ? monthlyVolume / s3.humanVolume : 1;
    const postCV = s1.cv * cvMultiplier;

    // AI cost stack breakdown
    const aiStack = [
      { name: "Orchestration / Platform", value: aiOrchestration, color: "#a855f7" },
      { name: "Text-to-Speech (TTS)", value: aiTTS, color: "#8b5cf6" },
      { name: "Speech-to-Text (STT)", value: aiSTT, color: "#6366f1" },
      { name: "LLM Inference", value: aiLLM, color: "#3b82f6" },
      { name: "SIP Trunking", value: aiSIP, color: "#06b6d4" },
      { name: "Compliance / PII", value: aiCompliance, color: "#0891b2" },
    ];

    // Volume sensitivity sweep (classic mode) — sweep volume ±  from current
    const volMultipliers = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
    const volumeSweepData = volMultipliers.map((m) => {
      const vol = Math.round(monthlyVolume * m);
      const sv = computeScenarioCost({
        ...shared, monthlyVolume: vol, ahtMins: aht,
        aiEnabled: false, containmentRate: 0, escalationRate: 0,
      });
      return {
        label: vol >= 1000 ? `${(vol / 1000).toFixed(0)}k` : `${vol}`,
        Traditional: Math.round(sv.traditionalCost),
        ShyftOff: Math.round(sv.gigCost),
        isCurrent: m === 1.0,
      };
    });

    // Sensitivity analysis: cost at different containment rates
    // "Naive Linear Estimate" = what buyers ASSUME they'll get: preTraditional × (1 - containment).
    // The gap between this dashed line and the real "Traditional + AI" line is the headline story.
    const sensitivityData = [50, 60, 65, 70, 75, 80, 85, 90].map((cr) => {
      const cRate = cr / 100;
      const sT = computeScenarioCost({ ...shared, monthlyVolume, ahtMins: aht,
        aiEnabled: true, containmentRate: cRate, escalationRate });
      return {
        containment: `${cr}%`,
        "Traditional + AI": Math.round(sT.traditionalTotal),
        "ShyftOff + AI": Math.round(sT.gigTotal),
        "Trad (no AI)": Math.round(preTraditional),
        "Naive Linear Estimate": Math.round(preTraditional * (1 - cRate)),
      };
    });

    // Cost per resolved contact
    const cprc = {
      preTraditional: preTraditional / monthlyVolume,
      preGig: preGig / monthlyVolume,
      postTraditional: postTraditional / monthlyVolume,
      postGig: postGig / monthlyVolume,
    };

    // Annual savings: post-gig vs pre-traditional
    const annualSavings = (preTraditional - postGig) * 12;
    const savingsPct = preTraditional > 0 ? (preTraditional - postGig) / preTraditional : 0;

    // Build interval chart data for demand visualization
    const intervalChart = s1.intervals.map((iv, i) => ({
      label: iv.label,
      "Pre-AI Demand": Math.round(iv.required),
      "Post-AI Human Demand": Math.round(s3.intervals[i]?.required || 0),
    }));

    // ── Staffing inflexibility visualization ─────────────────────────────────
    // In AI mode we show the POST-AI traditional staffing curve (s3) instead
    // of the pre-AI baseline (s1). That's where the real story lives — the
    // residual stream after AI containment is bumpier (higher CV, lower mean)
    // and traditional shift-block scheduling struggles to match it.
    // In classic mode we keep s1 because there's no AI scenario yet.
    const chartScenario = showAI ? s3 : s1;
    const chartOnPhones = computeOnPhones(
      chartScenario.shiftDefs,
      chartScenario.shiftAgents,
      chartScenario.intervals.length,
      inCenterShrink / 100,
      outOfCenterShrink / 100,
      chartScenario.intervals.map((iv) => iv.required),
    );
    const outOfCenterFrac = outOfCenterShrink / 100;
    const staffingChartData = chartScenario.intervals.map((iv, i) => ({
      label: iv.label,
      "Scheduled (Shifts)": chartScenario.scheduledPerInterval[i] || 0,
      "In Center": Math.round((chartScenario.scheduledPerInterval[i] || 0) * (1 - outOfCenterFrac)),
      "Required (Erlang C)": iv.required,
      "Actual On-Phones": chartOnPhones[i] || 0,
    }));

    // Per-shift table: time window, headcount, avg needed, utilization, waste.
    // In AI mode this follows the chart and uses s3 (post-AI traditional) so
    // the numbers below the chart match the noisy residual-demand schedule
    // shown above. Classic mode keeps s1 because there's no AI scenario.
    const shiftTableRows = chartScenario.shiftDefs.map((sh, idx) => {
      const startGlobal = startHour * 2 + sh.startIdx;
      const endGlobal = Math.min(startHour * 2 + sh.endIdx, 47);
      const startLabel = arrivalCurve[startGlobal]?.label ?? "—";
      const endLabel = arrivalCurve[endGlobal]?.label ?? "—";
      const m = chartScenario.shiftMetrics[idx];
      const agents = chartScenario.shiftAgents[idx];
      const inefficiencyCostMonth = m.inefficiencyHrsDay * chartScenario.workDaysPerMonth * chartScenario.loadedRate;
      return {
        name: `Shift ${idx + 1}`,
        window: `${startLabel} – ${endLabel}`,
        agents,
        avgNeeded: Math.round(m.avgTarget),
        utilizationPct: m.utilizationPct,
        inefficiencyHrsDay: m.inefficiencyHrsDay,
        inefficiencyCostMonth,
      };
    }).filter((r) => r.agents > 0);

    const totalInefficiencyHrsDay = shiftTableRows.reduce((s, r) => s + r.inefficiencyHrsDay, 0);
    const totalInefficiencyCostMonth = shiftTableRows.reduce((s, r) => s + r.inefficiencyCostMonth, 0);

    // Estimated abandonment from interval-level shortfall.
    // For each interval, shortfall_i = max(0, target_i − scheduled_i) where
    // target_i = ceil(required_i / (1 - shrink)) (heads-in-seats target the
    // solver was aiming for). Weighted by call volume so peak intervals
    // dominate.
    //
    // Calibration: even at 120%+ coverage, shift-block geometry creates an
    // intrinsic ~10% per-interval shortfall (3 staggered shifts can't perfectly
    // match a U-shaped demand curve), but this DOESN'T translate to abandonment
    // because callers wait briefly through small gaps. We subtract a 10%
    // baseline and multiply the EXCESS by a patience factor of 0.40 — yielding
    // ~3% abandon at 100% coverage and ~6% at 90% coverage, matching published
    // BPO benchmarks (5-8% industry average, <2% world-class).
    //
    // This is an INDICATIVE estimate, not a full Erlang A model. We anchor it
    // on (1) weighted shortfall is a standard WFM intraday metric, and (2) the
    // 10% baseline + 0.40 patience multiplier are calibration knobs we can
    // tune as real data comes in.
    let weightedShortfall = 0;
    let totalCalls = 0;
    // Interval-coverage delta: ShyftOff staffs every interval to required
    // (interval matching); traditional shift blocks under-cover some intervals.
    // Counting under-staffed intervals/day gives a quality-of-coverage metric
    // for the Simple view (no $/call assumption needed).
    let underStaffedIntervalsDay = 0;
    for (let i = 0; i < s1.intervals.length; i++) {
      const iv = s1.intervals[i];
      const sched = (s1.scheduledPerInterval && s1.scheduledPerInterval[i]) || 0;
      const target = Math.ceil(iv.required / (1 - shrink));
      totalCalls += iv.calls;
      if (target > 0 && sched < target) {
        weightedShortfall += ((target - sched) / target) * iv.calls;
        underStaffedIntervalsDay += 1;
      }
    }
    weightedShortfall = totalCalls > 0 ? weightedShortfall / totalCalls : 0;
    // Operating days/week from DOW distribution (any day with non-zero share).
    const operatingDaysPerWeek = [
      inputs.dowMon, inputs.dowTue, inputs.dowWed, inputs.dowThu,
      inputs.dowFri, inputs.dowSat, inputs.dowSun,
    ].filter((d) => d > 0).length;
    const underStaffedIntervalsWeek = underStaffedIntervalsDay * operatingDaysPerWeek;
    const SHIFT_GEOMETRY_BASELINE = 0.10;
    const PATIENCE_FACTOR = 0.40;
    const estimatedAbandonment = Math.max(
      0,
      weightedShortfall - SHIFT_GEOMETRY_BASELINE,
    ) * PATIENCE_FACTOR;

    // Diagnostics for the maxOcc slider:
    // - naturalMaxOcc: the highest occ at which minAchievedSL still meets the
    //   SL target. The slider's "reset to natural" button snaps here. This is
    //   dynamic — recomputes as volume/AHT/SL inputs drift.
    // - minAchievedSL: the worst SL across the day's intervals at the current
    //   maxOcc setting. When the user pushes the slider above natural, this
    //   drops below the target and the warning fires.
    // - slWarning: derived flag for the UI's amber state.
    const naturalMaxOccPct = Math.round((s1.naturalMaxOcc || 0.85) * 100);
    // Warning fires on the call-weighted "daily SL" — the same number BPO
    // managers report up the chain. Tolerance is ±3pp (real WFM accepts
    // some daily variance from target — 80/20 is a target, not a contract).
    // Below target − 3pp = real SL miss, fire the warning.
    const dailySL = s1.achievedSL != null ? s1.achievedSL : s1.minAchievedSL;
    const slWarning = dailySL < targetSL - 0.03;

    return {
      s1, s2, s3, s4,
      preTraditional, preGig, postTraditional, postGig,
      aiCostPerMin, aiCostBase, aiStack,
      s3AIMonthlyCost: s3.aiMonthlyCost,
      s3AIHandledCalls: s3.aiHandledCalls,
      cvMultiplier, preCV: s1.cv, postCV,
      volumeSweepData, sensitivityData, cprc, annualSavings, savingsPct,
      intervalChart,
      humanVolumePostAI: s3.humanVolume,
      humanAHTPostAI: s3.humanAHT,
      avgFTEPreTrad: s1.avgFTE,
      avgFTEPostTrad: s3.avgFTE,
      staffingChartData,
      shiftTableRows,
      totalInefficiencyHrsDay,
      totalInefficiencyCostMonth,
      naturalMaxOccPct,
      minAchievedSL: s1.minAchievedSL,
      achievedSL: dailySL,
      slWarning,
      estimatedAbandonment,
      weightedShortfall,
      underStaffedIntervalsDay,
      underStaffedIntervalsWeek,
      operatingDaysPerWeek,
    };
  }, [inputs, gigTiers, arrivalCurve]);

  const TABS = [
    { id: "scenarios", label: showAI ? "4 Scenarios" : "Scenarios" },
    { id: "staffing", label: "Staffing Impact" },
    ...(showAI ? [{ id: "ai-costs", label: "AI Cost Stack" }] : []),
    { id: "summary", label: "Summary" },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0b0f",
      fontFamily: "'DM Sans', system-ui, sans-serif", color: "#e2e0e7",
    }}>
      {/* Header */}
      <div className="calc-header" style={{
        borderBottom: "1px solid #1e1f2e", padding: "18px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#0d0e14",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: "#a855f7",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800, color: "#fff",
          }}>S</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
              ShyftOff ROI Calculator
            </div>
            <div style={{ fontSize: 12, color: "#6b6878" }}>
              {showAI
                ? "Pre vs. post-AI economics — traditional contact center vs. ShyftOff"
                : "Compare traditional contact center vs. ShyftOff"}
            </div>
          </div>
        </div>
        <div className="calc-header-controls" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* Simple / Detailed segmented control */}
          <div style={{
            display: "inline-flex", background: "#13141a", border: "1px solid #2a2b3d",
            borderRadius: 6, padding: 2,
          }}>
            {["simple", "detailed"].map((m) => (
              <button key={m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? "#1a1228" : "transparent",
                  border: mode === m ? "1px solid #a855f7" : "1px solid transparent",
                  color: mode === m ? "#a855f7" : "#6b6878",
                  borderRadius: 4, padding: "4px 12px", fontSize: 11, fontWeight: 600,
                  cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  textTransform: "capitalize",
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAI(!showAI)}
            style={{
              background: showAI ? "#1a1228" : "#13141a",
              border: `1px solid ${showAI ? "#a855f7" : "#2a2b3d"}`,
              color: showAI ? "#a855f7" : "#8a8891",
              borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {showAI ? "✓ AI scenarios on" : "+ Add AI scenarios"}
          </button>
        </div>
      </div>

      {/* ── SIMPLE view (exec headline) ─────────────────────────────────── */}
      {mode === "simple" && (() => {
        // Mirror the Summary tab's hero-savings logic so the two views agree:
        // baseline is always pre-AI Traditional; comparison is postGig with AI
        // on, preGig otherwise.
        const monthlyTrad = results.preTraditional;
        const monthlyShyft = showAI ? results.postGig : results.preGig;
        const monthlySavings = monthlyTrad - monthlyShyft;
        const savingsPct = monthlyTrad > 0 ? monthlySavings / monthlyTrad : 0;
        return (
          <div style={{ padding: "40px 24px 80px", maxWidth: 760, margin: "0 auto" }}>

            {/* Inputs */}
            <div style={{
              background: "#0d0e14", border: "1px solid #1e1f2e", borderRadius: 12,
              padding: "22px 26px", marginBottom: 22,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                textTransform: "uppercase", color: "#a855f7", marginBottom: 16 }}>
                Inputs
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <InputRow label="Monthly Call Volume" hint="calls/mo">
                  <NumInput value={inputs.monthlyVolume} onChange={(v) => set("monthlyVolume", v)} min={1000} step={1000} />
                </InputRow>
                <InputRow label="ShyftOff Rate" hint="flat loaded, $/hr">
                  <div style={{
                    background: "#1a1228", border: "1px solid #a855f7", borderRadius: 6,
                    padding: "7px 10px", display: "flex", justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <span style={{ fontSize: 11, color: "#8a8891" }}>ShyftOff Standard</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#a855f7",
                      fontFamily: "'Space Mono', monospace" }}>
                      ${fmtD(results.s1.gigRate, 2)}/hr
                    </span>
                  </div>
                </InputRow>
                <InputRow label="Opens">
                  <TimeSelect value={inputs.startHour} onChange={(v) => set("startHour", v)} min={0} max={23} />
                </InputRow>
                <InputRow label="Closes">
                  <TimeSelect value={inputs.endHour} onChange={(v) => set("endHour", v)} min={1} max={24} />
                </InputRow>
              </div>

              {showAI && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: "#a855f7", marginBottom: 10 }}>
                    AI Tier
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {Object.entries(TIER_PRESETS).map(([key, preset]) => {
                      const active = selectedTier === key;
                      return (
                        <button key={key} onClick={() => applyPreset(key)} style={{
                          background: active ? "#1a1228" : "#0a0b0f",
                          border: `1px solid ${active ? preset.color : "#2a2b3d"}`,
                          borderRadius: 7, padding: "9px 8px", cursor: "pointer",
                          textAlign: "center",
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700,
                            color: active ? preset.color : "#6b6878", lineHeight: 1.2 }}>
                            {key === "lean" ? "Lean" : key === "standard" ? "Standard" : "Human-like"}
                          </div>
                          <div style={{ fontSize: 9, color: active ? "#8a8891" : "#4a4855", marginTop: 3 }}>
                            {Math.round(preset.defaultContainment * 100)}% containment
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Savings hero */}
            <div style={{
              background: "linear-gradient(135deg, #1a1228 0%, #0f0a1e 100%)",
              border: "1px solid #a855f7", borderRadius: 14,
              padding: "32px 36px", textAlign: "center",
              boxShadow: "0 0 40px rgba(168,85,247,0.12)", marginBottom: 18,
            }}>
              <div style={{ fontSize: 11, color: "#8a8891", marginBottom: 10,
                letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {showAI ? "Monthly savings — ShyftOff + AI vs Traditional" : "Monthly savings — ShyftOff vs Traditional"}
              </div>
              <div style={{ fontSize: 52, fontWeight: 900, color: "#22c55e",
                fontFamily: "Space Mono, monospace", lineHeight: 1 }}>
                {fmtCur(monthlySavings)}
              </div>
              <div style={{ fontSize: 15, color: "#a855f7", marginTop: 8, fontWeight: 600 }}>
                {fmtD(savingsPct * 100, 1)}% reduction · {fmtCur(monthlySavings * 12)}/yr
              </div>

              {/* Trad vs ShyftOff side-by-side */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24,
                marginTop: 28, paddingTop: 22, borderTop: "1px solid #2a1f3d" }}>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 10, color: "#6b6878", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Traditional
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#ef4444",
                    fontFamily: "Space Mono, monospace", marginTop: 4 }}>
                    {fmtCur(monthlyTrad)}
                  </div>
                  <div style={{ fontSize: 10, color: "#4a4855", marginTop: 2 }}>per month</div>
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 10, color: "#6b6878", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    ShyftOff{showAI ? " + AI" : ""}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#22c55e",
                    fontFamily: "Space Mono, monospace", marginTop: 4 }}>
                    {fmtCur(monthlyShyft)}
                  </div>
                  <div style={{ fontSize: 10, color: "#4a4855", marginTop: 2 }}>per month</div>
                </div>
              </div>
            </div>

            {/* Coverage delta — missed-call recovery proxy (interval-coverage) */}
            <div style={{
              background: "#0d0e14", border: "1px solid #1e1f2e", borderRadius: 12,
              padding: "18px 24px", marginBottom: 22,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "#a855f7", marginBottom: 8 }}>
                Coverage Recovery
              </div>
              <div style={{ fontSize: 14, color: "#e2e0e7", lineHeight: 1.5 }}>
                ShyftOff covers{" "}
                <strong style={{ color: "#22c55e", fontFamily: "'Space Mono', monospace" }}>
                  {results.underStaffedIntervalsWeek}
                </strong>{" "}
                more intervals/week than the traditional shift-block schedule.
              </div>
              <div style={{ fontSize: 11, color: "#6b6878", marginTop: 6, lineHeight: 1.5 }}>
                Traditional under-staffs {results.underStaffedIntervalsDay} interval{results.underStaffedIntervalsDay === 1 ? "" : "s"}
                {" "}per operating day; ShyftOff matches required staffing every interval.
              </div>
            </div>

            {/* Switch-to-detailed hint */}
            <div style={{ textAlign: "center", fontSize: 11, color: "#4a4855" }}>
              Switch to{" "}
              <button onClick={() => setMode("detailed")} style={{
                background: "none", border: "none", color: "#a855f7", cursor: "pointer",
                fontWeight: 700, fontSize: 11, fontFamily: "'DM Sans', sans-serif",
                padding: 0, textDecoration: "underline",
              }}>Detailed</button>
              {" "}to drill into staffing, shrinkage, Erlang C math, and the AI cost stack.
            </div>
          </div>
        );
      })()}

      {/* ── DETAILED view (full model surface) ──────────────────────────── */}
      {mode === "detailed" && (
      <div className="calc-layout" style={{ display: "grid", gridTemplateColumns: "360px 1fr", minHeight: "calc(100vh - 65px)" }}>

        {/* ── Left: Inputs ───────────────────────────────────────────────────── */}
        <div className="calc-inputs" style={{
          borderRight: "1px solid #1e1f2e", padding: "24px 20px",
          overflowY: "auto", background: "#0d0e14",
        }}>

          <SectionLabel>Contact Center</SectionLabel>
          <InputRow label="Monthly Call Volume" hint="calls/mo">
            <NumInput value={inputs.monthlyVolume} onChange={(v) => set("monthlyVolume", v)} min={1000} step={1000} />
          </InputRow>
          <InputRow label="Avg Handle Time" hint="minutes" tooltip="Average call length, talk plus after-call work. Industry: 5–7 min for service, 8–12 min for tech support. Post-AI, we model the residual stream as longer because AI deflects the easy calls first — what's left is harder.">
            <NumInput value={inputs.aht} onChange={(v) => set("aht", v)} min={1} max={60} step={0.5} suffix="min" />
          </InputRow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InputRow label="Opens">
              <TimeSelect value={inputs.startHour} onChange={(v) => set("startHour", v)} min={0} max={23} />
            </InputRow>
            <InputRow label="Closes">
              <TimeSelect value={inputs.endHour} onChange={(v) => set("endHour", v)} min={1} max={24} />
            </InputRow>
          </div>
          {showAdvanced && (<>
          <InputRow label="Shrinkage" hint={`total ${inputs.inCenterShrink + inputs.outOfCenterShrink}% · ↑ shrink = ↑ trad cost`} tooltip="Time agents are paid but unavailable for calls. In-Center = breaks, lunch, coaching, system meetings. Out-of-Center = training, PTO, sick. Industry standard 30–35%. ShyftOff carries its own utilization adjustment, not this number — that's where the structural cost gap comes from.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "#4a4855", marginBottom: 4 }}>In-Center</div>
                <NumInput value={inputs.inCenterShrink} onChange={(v) => set("inCenterShrink", v)} min={0} max={50} suffix="%" />
                <div style={{ fontSize: 9, color: "#3a3b4d", marginTop: 3 }}>breaks · lunch · coaching</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#4a4855", marginBottom: 4 }}>Out-of-Center</div>
                <NumInput value={inputs.outOfCenterShrink} onChange={(v) => set("outOfCenterShrink", v)} min={0} max={50} suffix="%" />
                <div style={{ fontSize: 9, color: "#3a3b4d", marginTop: 3 }}>training · PTO · sick</div>
              </div>
            </div>
          </InputRow>
          <InputRow label="Intraday Arrival Pattern" hint={ARRIVAL_PRESETS[arrivalKey].hint}>
            <select
              value={arrivalKey}
              onChange={(e) => setArrivalKey(e.target.value)}
              style={{
                width: "100%", background: "#0d0e14", border: "1px solid #2a2b3d", color: "#e2e0e7",
                borderRadius: 6, padding: "7px 10px", fontSize: 13,
                fontFamily: "'DM Sans', sans-serif", cursor: "pointer", outline: "none",
              }}
            >
              {Object.entries(ARRIVAL_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>{p.label} — {p.hint}</option>
              ))}
            </select>
          </InputRow>
          <InputRow label="Day-of-Week Volume Distribution" hint="% of weekly calls · 0 = closed">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 4 }}>
              {[
                ["Mon", "dowMon"], ["Tue", "dowTue"], ["Wed", "dowWed"], ["Thu", "dowThu"],
                ["Fri", "dowFri"], ["Sat", "dowSat"], ["Sun", "dowSun"],
              ].map(([label, key]) => (
                <div key={key} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#4a4855", marginBottom: 3, fontWeight: 600,
                    color: inputs[key] === 0 ? "#2a2b3d" : "#6b6878" }}>{label}</div>
                  <input type="number" value={inputs[key]} min={0} max={30} step={0.5}
                    onChange={(e) => set(key, parseFloat(e.target.value) || 0)}
                    style={{
                      width: "100%", background: inputs[key] === 0 ? "#0a0b0f" : "#0d0e14",
                      border: `1px solid ${inputs[key] === 0 ? "#1a1b26" : "#2a2b3d"}`,
                      borderRadius: 5, color: inputs[key] === 0 ? "#2a2b3d" : "#e2e0e7",
                      padding: "5px 3px", fontSize: 11, textAlign: "center",
                      fontFamily: "'Space Mono', monospace", outline: "none",
                    }} />
                </div>
              ))}
            </div>
          </InputRow>
          </>)}

          <div style={{ borderTop: "1px solid #1e1f2e", margin: "16px 0" }} />
          <SectionLabel>Service Level</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InputRow label="SL Target" tooltip="Service Level: 'X% of calls answered in Y seconds.' Industry default is 80/20 — 80% answered within 20 seconds. Drives the Erlang C staffing requirement: tighter SL ⇒ more agents needed."  >
              <NumInput value={inputs.serviceLevelTarget} onChange={(v) => set("serviceLevelTarget", v)} min={50} max={99} suffix="%" />
            </InputRow>
            <InputRow label="Answer In">
              <NumInput value={inputs.serviceLevelThreshold} onChange={(v) => set("serviceLevelThreshold", v)} min={5} max={120} suffix="sec" />
            </InputRow>
          </div>
          {showAdvanced && (
          <InputRow label="Optimal Occupancy" tooltip="Max % of paid time agents spend on calls. Above ~85% you trade SL for cost — queue times spike, burnout and attrition follow. The slider auto-defaults to the highest occupancy that still meets your SL target; push it higher and you'll see a silent SL warning.">
            {/* Floating % bubble above the slider, positioned over the thumb. */}
            <div style={{ position: "relative", height: 18, marginBottom: 2 }}>
              <span style={{
                position: "absolute",
                // (value − min) / (max − min) gives the thumb's fractional
                // position along the track. The -14px nudge centers the
                // label over the thumb (label is ~28px wide for 2-digit %).
                left: `calc(${((inputs.maxOccupancy - 1) / 98) * 100}% - 14px)`,
                fontSize: 12, fontWeight: 700, color: "#a855f7",
                fontFamily: "Space Mono, monospace",
                transition: "left 80ms linear",
                pointerEvents: "none",
              }}>
                {inputs.maxOccupancy}%
              </span>
            </div>
            <Slider value={inputs.maxOccupancy} onChange={(v) => set("maxOccupancy", v)} min={1} max={99} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <span style={{ fontSize: 10, color: results.slWarning ? "#f59e0b" : "#22c55e" }}>
                achieved SL: {Math.round(results.achievedSL * 100)}%
                {results.slWarning
                  ? <> · ⚠ below target — occ-driven staffing dropping SL</>
                  : <> · meets target ✓</>}
              </span>
              {inputs.maxOccupancy !== results.naturalMaxOccPct && (
                <button
                  type="button"
                  onClick={() => set("maxOccupancy", results.naturalMaxOccPct)}
                  title={`Reset to natural (${results.naturalMaxOccPct}%) — the highest occ that still meets SL`}
                  style={{
                    background: "transparent", border: "1px solid #2a2b3d",
                    borderRadius: 4, color: "#6b6878", padding: "1px 6px",
                    fontSize: 10, cursor: "pointer", fontFamily: "Space Mono, monospace",
                  }}
                >↻ {results.naturalMaxOccPct}%</button>
              )}
            </div>
          </InputRow>
          )}

          <div style={{ borderTop: "1px solid #1e1f2e", margin: "16px 0" }} />
          <SectionLabel>Human Cost Model</SectionLabel>
          <InputRow label="Agent Rate" hint="$/hr">
            <NumInput value={inputs.traditionalRate} onChange={(v) => set("traditionalRate", v)} min={10} step={0.5} prefix="$" suffix="/hr" />
          </InputRow>
          {showAdvanced && (<>
          <InputRow label="Benefits + Tax">
            <NumInput value={inputs.benefitsMultiplier} onChange={(v) => set("benefitsMultiplier", v)} min={0} max={100} suffix="%" />
          </InputRow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InputRow label="Shift Length" hint="hrs">
              <NumInput value={inputs.shiftLength} onChange={(v) => set("shiftLength", v)} min={4} max={12} step={0.5} suffix="hrs" />
            </InputRow>
            <InputRow
              label="Coverage Target"
              hint={
                inputs.influxTarget < 100
                  ? "lean — intentional SL miss"
                  : inputs.influxTarget > 110
                    ? "padded — safety cushion"
                    : "balanced — meets target"
              }
            >
              <NumInput value={inputs.influxTarget} onChange={(v) => set("influxTarget", v)} min={70} max={150} step={5} suffix="%" />
            </InputRow>
          </div>

          <div style={{
            background: "#0a0b0f", border: "1px solid #1e1f2e", borderRadius: 8,
            padding: "12px 14px", marginBottom: 14,
          }}>
            <div style={{ fontSize: 10, color: "#6b6878", fontWeight: 600, marginBottom: 8,
              textTransform: "uppercase", letterSpacing: "0.06em" }}>Support staffing ratios (1 per N agents)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <InputRow label="Sup">
                <NumInput value={inputs.agentsPerSup} onChange={(v) => set("agentsPerSup", v)} min={1} max={100} />
              </InputRow>
              <InputRow label="Mgr">
                <NumInput value={inputs.agentsPerMgr} onChange={(v) => set("agentsPerMgr", v)} min={1} max={200} />
              </InputRow>
              <InputRow label="WFM">
                <NumInput value={inputs.agentsPerWfm} onChange={(v) => set("agentsPerWfm", v)} min={1} max={500} />
              </InputRow>
            </div>
            <div style={{ fontSize: 10, color: "#6b6878", fontWeight: 600, marginTop: 6, marginBottom: 6,
              textTransform: "uppercase", letterSpacing: "0.06em" }}>Annual salary ($)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <InputRow label="Sup">
                <NumInput value={inputs.supSalary} onChange={(v) => set("supSalary", v)} min={20000} max={250000} step={1000} prefix="$" />
              </InputRow>
              <InputRow label="Mgr">
                <NumInput value={inputs.mgrSalary} onChange={(v) => set("mgrSalary", v)} min={20000} max={250000} step={1000} prefix="$" />
              </InputRow>
              <InputRow label="WFM">
                <NumInput value={inputs.wfmSalary} onChange={(v) => set("wfmSalary", v)} min={20000} max={250000} step={1000} prefix="$" />
              </InputRow>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InputRow label="Workstation cost" hint="per seat">
              <NumInput value={inputs.workstationCost} onChange={(v) => set("workstationCost", v)} min={0} max={10000} step={100} prefix="$" />
            </InputRow>
            <InputRow label="Equip. life" hint="months">
              <NumInput value={inputs.equipmentLife} onChange={(v) => set("equipmentLife", v)} min={12} max={120} suffix="mo" />
            </InputRow>
          </div>
          </>)}

          <InputRow label="ShyftOff Rate" hint="flat loaded rate, no AI-tier or volume adjustment" tooltip="Interval matching: traditional centers staff full shifts, which over-cover slow intervals and under-cover peaks. ShyftOff staffs interval-by-interval — agents log in for the windows you actually need. The flat $/hr rate already loads benefits, supervision, and platform — no extras.">
            <div style={{
              background: "#1a1228", border: "1px solid #a855f7", borderRadius: 6,
              padding: "10px 12px", display: "flex", justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: 11, color: "#8a8891" }}>ShyftOff Standard</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#a855f7",
                fontFamily: "'Space Mono', monospace" }}>
                ${fmtD(results.s1.gigRate, 2)}/hr
              </span>
            </div>
          </InputRow>

          {/* Advanced expander — hides 13 power-user inputs behind one click.
              When collapsed, the panel shows only the 7 inputs that matter
              to a contact-center buyer. When expanded, the advanced rows
              slot back into their conceptual sections inline. */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              width: "100%", background: "transparent",
              border: "1px dashed #2a2b3d", borderRadius: 6,
              color: "#6b6878", padding: "8px 10px", marginTop: 4,
              fontSize: 11, fontWeight: 600, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 6, transition: "all 120ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#a855f7"; e.currentTarget.style.borderColor = "#a855f7"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#6b6878"; e.currentTarget.style.borderColor = "#2a2b3d"; }}
          >
            <span>{showAdvanced ? "− Hide advanced" : "+ Show advanced"}</span>
            <span style={{ fontSize: 9, color: "#4a4855" }}>
              {showAdvanced
                ? "(collapses shrinkage, ratios, salaries, etc.)"
                : "(shrinkage, occupancy, ratios, salaries, workstation)"}
            </span>
          </button>

          {showAI && (<>
          <div style={{ borderTop: "1px solid #1e1f2e", margin: "16px 0" }} />
          <SectionLabel>AI Configuration</SectionLabel>
          <InputRow label="AI Containment Rate" hint="% of calls AI fully resolves" tooltip="% of contacts AI fully resolves without a human. Gartner Oct 2025 (n=321): industry median ~50%, top quartile 70%+. Tier midpoints — Lean 32.5% (FAQ deflection), Standard 52.5% (multi-turn NLU), Human-like 72.5% (conversational).">
            <Slider value={Math.round(inputs.containmentRate * 100)} onChange={(v) => set("containmentRate", v / 100)} min={25} max={95} color="#a855f7" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#4a4855" }}>25%</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#a855f7", fontFamily: "Space Mono, monospace" }}>
                {Math.round(inputs.containmentRate * 100)}%
              </span>
              <span style={{ fontSize: 10, color: "#4a4855" }}>95%</span>
            </div>
            <div style={{ fontSize: 10, color: "#6b6878", marginTop: 6, lineHeight: 1.4, fontStyle: "italic" }}>
              Gartner survey (Oct 2025, n=321 customer-service leaders): only{" "}
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>20%</span> cut agent headcount due to AI;{" "}
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>55%</span> kept staffing stable on higher volumes.
              Containment ≠ staffing cut — see the gap on the Scenarios tab.
            </div>
          </InputRow>
          <InputRow label="Escalation Rate" hint="% of AI calls that go to human" tooltip="% of AI-handled calls that escalate to a human anyway (failed containment, customer demand, edge cases). Industry band 15–25%. The cascade is: containment × (1 − escalation) = net volume kept off humans.">
            <Slider value={Math.round(inputs.escalationRate * 100)} onChange={(v) => set("escalationRate", v / 100)} min={5} max={50} color="#f59e0b" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#4a4855" }}>5%</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", fontFamily: "Space Mono, monospace" }}>
                {Math.round(inputs.escalationRate * 100)}%
              </span>
              <span style={{ fontSize: 10, color: "#4a4855" }}>50%</span>
            </div>
          </InputRow>
          {/* AHT Variability (CV) and the percentile table were removed in
              Round 1. CV is hardcoded to 0.6 (industry voice-call default) in
              the lib pass-through above. Add them back via the Detailed-mode
              toggle in Round 3 if users want to see / tune the distribution. */}
          <InputRow label="Post-AI Wage Premium (Trad)" hint="Tier-2 vs Tier-1 differential · industry: 20–30% (ZipRecruiter 2026)" tooltip="When AI absorbs Tier-1 (routine) work, the human stream is all Tier-2 (complex). Tier-2 agents cost more — ZipRecruiter 2026 shows 20–30% wage premium over Tier-1. Applies to the traditional base wage only; ShyftOff rate is untouched.">
            <Slider value={inputs.postAiWagePremium} onChange={(v) => set("postAiWagePremium", v)} min={0} max={80} color="#f59e0b" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#4a4855" }}>0%</span>
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", fontFamily: "Space Mono, monospace" }}>
                  +{inputs.postAiWagePremium}%
                </span>
                <span style={{ fontSize: 10, color: "#4a4855", marginLeft: 5 }}>
                  (${fmtD(inputs.traditionalRate * (1 + inputs.postAiWagePremium / 100), 2)}/hr)
                </span>
              </div>
              <span style={{ fontSize: 10, color: "#4a4855" }}>80%</span>
            </div>
          </InputRow>

          <div style={{ borderTop: "1px solid #1e1f2e", margin: "16px 0" }} />
          <SectionLabel>AI Cost Stack ($/min)</SectionLabel>

          {/* Tier preset selector */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14 }}>
            {Object.entries(TIER_PRESETS).map(([key, preset]) => {
              const active = selectedTier === key;
              return (
                <button key={key} onClick={() => applyPreset(key)} style={{
                  background: active ? "#1a1228" : "#0d0e14",
                  border: `1px solid ${active ? preset.color : "#2a2b3d"}`,
                  borderRadius: 7, padding: "7px 6px", cursor: "pointer",
                  textAlign: "center", transition: "all 0.15s",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: active ? preset.color : "#4a4855", lineHeight: 1.2 }}>
                    {key === "lean" ? "Lean" : key === "standard" ? "Standard" : key === "humanlike" ? "Human-like" : key}
                  </div>
                  <div style={{ fontSize: 9, color: active ? "#8a8891" : "#3a3845", marginTop: 2 }}>{preset.range}/min</div>
                </button>
              );
            })}
          </div>
          {selectedTier !== "custom" && (
            <div style={{ fontSize: 10, color: "#6b6878", marginBottom: 12, lineHeight: 1.4 }}>
              <span style={{ color: TIER_PRESETS[selectedTier].color, fontWeight: 600 }}>
                {TIER_PRESETS[selectedTier].vendors}
              </span>
            </div>
          )}

          {[
            { key: "aiSIP", label: "SIP Trunking" },
            { key: "aiSTT", label: "Speech-to-Text" },
            { key: "aiLLM", label: "LLM Inference" },
            { key: "aiTTS", label: "Text-to-Speech" },
            { key: "aiOrchestration", label: "Orchestration / Platform" },
            { key: "aiCompliance", label: "Compliance / PII Redaction" },
          ].map(({ key, label }) => (
            <InputRow key={key} label={label}>
              <NumInput value={inputs[key]} onChange={(v) => set(key, v)} min={0} max={1} step={0.001} prefix="$" suffix="/min" />
            </InputRow>
          ))}
          <InputRow label="Failure / Retry Buffer">
            <NumInput value={inputs.aiFailureBuffer} onChange={(v) => set("aiFailureBuffer", v)} min={0} max={20} suffix="%" />
          </InputRow>

          {/* Blended rate summary */}
          <div style={{
            background: "#1a1228", border: "1px solid #a855f7", borderRadius: 8,
            padding: "12px 14px", marginTop: 4,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "#8a8891" }}>Blended AI rate</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#a855f7", fontFamily: "Space Mono, monospace" }}>
                {fmtCurD(results.aiCostPerMin, 4)}/min
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "#8a8891" }}>Per {inputs.aht}-min call</span>
              <span style={{ fontSize: 12, color: "#a855f7", fontFamily: "Space Mono, monospace" }}>
                {fmtCurD(results.aiCostPerMin * inputs.aht, 3)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px solid #2a1a3d" }}>
              <span style={{ fontSize: 11, color: "#8a8891" }}>
                Hourly @ {inputs.maxOccupancy}% occ
                <span style={{ fontSize: 9, color: "#4a4855", display: "block", marginTop: 1 }}>
                  60 min × {inputs.maxOccupancy}% × {fmtCurD(results.aiCostPerMin, 4)}/min
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#a855f7", fontFamily: "Space Mono, monospace" }}>
                {fmtCurD(60 * (inputs.maxOccupancy / 100) * results.aiCostPerMin, 2)}/hr
              </span>
            </div>
          </div>
          </>)}
        </div>

        {/* ── Right: Results ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", overflowY: "auto" }}>

          {/* Tab bar */}
          <div style={{
            display: "flex", gap: 2, padding: "0 24px",
            borderBottom: "1px solid #1e1f2e", background: "#0d0e14",
          }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "14px 18px", fontSize: 13, fontWeight: 600,
                color: activeTab === t.id ? "#a855f7" : "#6b6878",
                borderBottom: activeTab === t.id ? "2px solid #a855f7" : "2px solid transparent",
                marginBottom: -1, transition: "color 0.15s",
              }}>{t.label}</button>
            ))}
          </div>

          <div className="calc-content" style={{ padding: "24px 24px 40px", flex: 1 }}>

            {/* ══ TAB 1: 4 SCENARIOS ══════════════════════════════════════════ */}
            {activeTab === "scenarios" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                {/* Callout banner — only meaningful when AI scenarios are visible */}
                {showAI && (
                  <div style={{
                    background: "linear-gradient(135deg, #1a100e 0%, #140b0a 100%)",
                    border: "1px solid #ef4444", borderRadius: 10, padding: "14px 20px",
                    display: "flex", alignItems: "center", gap: 14,
                  }}>
                    <div style={{ fontSize: 24 }}>⚠️</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>
                        AI + Traditional Staffing Costs MORE Than Doing Nothing
                      </div>
                      <div style={{ fontSize: 12, color: "#8a8891", marginTop: 2 }}>
                        AI agent costs add to a workforce you can't right-size — you pay for both.
                        Only flexible labor lets you fully capture AI savings.
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#ef4444", fontFamily: "Space Mono, monospace" }}>
                        +{fmtCur(results.postTraditional - results.preTraditional)}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b6878" }}>vs. status quo</div>
                    </div>
                  </div>
                )}

                {/* The Containment-to-Savings Gap — the headline narrative card */}
                {showAI && (() => {
                  const containmentPct = Math.round(inputs.containmentRate * 100);
                  const tradReductionPct = ((results.preTraditional - results.postTraditional) / results.preTraditional) * 100;
                  const gigReductionPct = ((results.preTraditional - results.postGig) / results.preTraditional) * 100;
                  const gapPct = containmentPct - tradReductionPct;
                  const fmtPct = (v) => `${v >= 0 ? "" : ""}${v.toFixed(0)}%`;
                  return (
                    <Card>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                          The Containment-to-Savings Gap
                        </div>
                        <div style={{ fontSize: 10, color: "#6b6878", fontStyle: "italic" }}>
                          peakedness-adjusted Erlang C (Hayward 1952 · Schrieck et al. POMS 2014)
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 14 }}>
                        Buyers assume <strong style={{ color: "#e2e0e7" }}>X% containment = X% staffing cut</strong>. It doesn't. Erlang C is non-linear, residual calls are harder, and traditional-center overhead (shrinkage, shift bloat, supervisor ratios) doesn't scale down.
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                        <div style={{ background: "#0d0e14", border: "1px solid #2a2b3d", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#6b6878", marginBottom: 4 }}>AI Containment</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#a855f7", fontFamily: "Space Mono, monospace" }}>
                            {containmentPct}%
                          </div>
                          <div style={{ fontSize: 9, color: "#4a4855", marginTop: 4 }}>what AI handles</div>
                        </div>
                        <div style={{ background: "#0d0e14", border: "1px solid #2a2b3d", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#6b6878", marginBottom: 4 }}>Traditional + AI cost change</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: tradReductionPct >= 0 ? "#22c55e" : "#ef4444", fontFamily: "Space Mono, monospace" }}>
                            {tradReductionPct >= 0 ? "−" : "+"}{Math.abs(tradReductionPct).toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 9, color: "#4a4855", marginTop: 4 }}>
                            {tradReductionPct >= 0 ? "actual savings" : "cost went UP (trap)"}
                          </div>
                        </div>
                        <div style={{ background: "#0d0e14", border: "1px solid #a855f7", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#a855f7", marginBottom: 4 }}>ShyftOff + AI cost change</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#22c55e", fontFamily: "Space Mono, monospace" }}>
                            −{gigReductionPct.toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 9, color: "#4a4855", marginTop: 4 }}>flex labor captures more</div>
                        </div>
                        <div style={{ background: "#1a1208", border: "1px solid #f59e0b", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#f59e0b", marginBottom: 4 }}>The Gap (Trad)</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b", fontFamily: "Space Mono, monospace" }}>
                            {gapPct.toFixed(0)} pts
                          </div>
                          <div style={{ fontSize: 9, color: "#4a4855", marginTop: 4 }}>containment % − savings %</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 14, padding: "10px 12px", background: "#0d0e14", borderRadius: 6, fontSize: 11, color: "#8a8891", lineHeight: 1.5 }}>
                        <strong style={{ color: "#e2e0e7" }}>Why the gap?</strong> AI handles routine calls; residual human calls are{" "}
                        <span style={{ color: "#06b6d4" }}>{fmtD((results.s3.ahtFactor - 1) * 100, 0)}% longer</span> (residual mean from log-normal distribution after AI cuts the easy tail) and{" "}
                        <span style={{ color: "#f59e0b" }}>{fmtD(results.cvMultiplier, 1)}× more volatile</span> (same noise, smaller mean) — which drives a{" "}
                        <span style={{ color: "#f59e0b" }}>+{fmtD((results.s3.volatilityBuffer - 1) * 100, 1)}% peakedness-adjusted staffing buffer</span> on top of base Erlang C.
                        Add a <span style={{ color: "#f59e0b" }}>+{inputs.postAiWagePremium}% wage premium</span> (Tier-2 skill, ZipRecruiter 2026)
                        and traditional-center still carrying full shrinkage + supervisor ratios on a smaller pie.
                        <span style={{ color: "#6b6878", display: "block", marginTop: 6, fontSize: 10, lineHeight: 1.55 }}>
                          <strong style={{ color: "#8a8891" }}>Gartner (Oct 2025 survey, n=321 customer-service leaders):</strong>{" "}
                          only <span style={{ color: "#f59e0b" }}>20%</span> cut agent headcount due to AI{" · "}
                          <span style={{ color: "#f59e0b" }}>55%</span> maintained stable staffing despite higher volumes{" · "}
                          <span style={{ color: "#f59e0b" }}>42%</span> are creating new AI-specific roles (strategists, conversational designers, automation analysts).{" "}
                          <em>Patrick Quinlan, Gartner Sr. Director Analyst: "Full automation will be prohibitively expensive for most organizations."</em>{" "}
                          Gartner forecasts <span style={{ color: "#f59e0b" }}>half of orgs that cut staff will rehire by 2027</span> (Feb 2026 prediction).
                        </span>
                      </div>
                    </Card>
                  );
                })()}

                {/* Scenario cards — 2 by default (classic), 4 when AI is on */}
                <div className="calc-scenarios-grid" style={{
                  display: "grid",
                  gridTemplateColumns: showAI ? "repeat(4, 1fr)" : "repeat(2, 1fr)",
                  gap: 12,
                }}>
                  <ScenarioCard
                    label="Traditional"
                    cost={results.preTraditional}
                    highlight="baseline"
                    color="#ef4444"
                    delta={0}
                    deltaLabel="(baseline)"
                  />
                  <ScenarioCard
                    label="ShyftOff"
                    cost={results.preGig}
                    color={showAI ? "#f59e0b" : "#22c55e"}
                    highlight={showAI ? undefined : "winner"}
                    tag={showAI ? undefined : "Best"}
                    delta={results.preGig - results.preTraditional}
                    deltaLabel="vs baseline"
                  />
                  {showAI && (
                    <>
                      <ScenarioCard
                        label="Traditional + AI"
                        cost={results.postTraditional}
                        color="#ef4444"
                        highlight="danger"
                        tag="Trap"
                        delta={results.postTraditional - results.preTraditional}
                        deltaLabel="vs baseline"
                      />
                      <ScenarioCard
                        label="ShyftOff + AI"
                        cost={results.postGig}
                        color="#22c55e"
                        highlight="winner"
                        tag="Best"
                        delta={results.postGig - results.preTraditional}
                        deltaLabel="vs baseline"
                      />
                    </>
                  )}
                </div>

                {/* Bar chart — static cost comparison */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Monthly Cost Comparison
                  </div>
                  <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                    {showAI
                      ? "All four scenarios at current inputs — the gap widens as containment rate increases"
                      : "Traditional traditional contact center vs. ShyftOff gig — per-month operating cost"}
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={showAI ? [
                      { name: "Trad\nNo AI", cost: results.preTraditional },
                      { name: "ShyftOff\nNo AI", cost: results.preGig },
                      { name: "Trad\n+ AI", cost: results.postTraditional },
                      { name: "ShyftOff\n+ AI", cost: results.postGig },
                    ] : [
                      { name: "Traditional", cost: results.preTraditional },
                      { name: "ShyftOff", cost: results.preGig },
                    ]} margin={{ top: 20, right: 20, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1f2e" />
                      <XAxis dataKey="name" tick={{ fill: "#6b6878", fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#6b6878", fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtCur(v)} labelStyle={{ color: "#fff" }}
                        contentStyle={{ background: "#13141a", border: "1px solid #2a2b3d" }} />
                      <Bar dataKey="cost" radius={[4, 4, 0, 0]}
                        label={<BarLabel formatter={(v) => `$${(v / 1000).toFixed(0)}k`} />}>
                        {(showAI ? [
                          { fill: "#ef4444" }, { fill: "#f59e0b" },
                          { fill: "#ef4444" }, { fill: "#a855f7" },
                        ] : [
                          { fill: "#ef4444" }, { fill: "#22c55e" },
                        ]).map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                {/* ── Where Your Paid Hours Actually Go — classic mode only ── */}
                {!showAI && (() => {
                  const productive = Math.round(results.s1.monthlyRequiredHours);
                  const tradScheduled = Math.round(results.s1.monthlyScheduledHours);

                  // Use the actual split inputs — no estimated ratios needed.
                  const inCenterWaste    = Math.round(tradScheduled * (inputs.inCenterShrink / 100));
                  const outOfCenterWaste = Math.round(tradScheduled * (inputs.outOfCenterShrink / 100));
                  // Schedule inefficiency: agents on the floor and available but not needed
                  // (pure shift-block over-coverage, independent of shrinkage).
                  const schedIneff = Math.max(0, tradScheduled - inCenterWaste - outOfCenterWaste - productive);
                  const tradWastePct = Math.round((tradScheduled - productive) / tradScheduled * 100);

                  const hoursData = [
                    { name: "Traditional", sub: `(${fmtD(results.avgFTEPreTrad, 0)} FTE in-house)`,
                      Productive: productive,
                      "In-Center Shrinkage": inCenterWaste,
                      "Out-of-Center Shrinkage": outOfCenterWaste,
                      "Schedule Inefficiency": schedIneff,
                      total: tradScheduled, wastePct: tradWastePct },
                    { name: "ShyftOff", sub: "(matched productive)",
                      Productive: productive,
                      "In-Center Shrinkage": 0,
                      "Out-of-Center Shrinkage": 0,
                      "Schedule Inefficiency": 0,
                      total: productive, wastePct: 0 },
                  ];

                  const CustomTick = ({ x, y, payload, index }) => {
                    const d = hoursData[index];
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <text dy={14} textAnchor="middle" fill="#8a8891" fontSize={11} fontWeight={600}>{payload.value}</text>
                        {d && <text dy={28} textAnchor="middle" fill="#4a4855" fontSize={10}>{d.sub}</text>}
                      </g>
                    );
                  };

                  const segLabel = ({ x, y, width, height, value }) => {
                    if (!value || height < 26) return null;
                    return (
                      <text x={x+width/2} y={y+height/2} textAnchor="middle" dominantBaseline="middle"
                        fill="rgba(255,255,255,0.85)" fontSize={11}>
                        {Math.round(value).toLocaleString()} hrs
                      </text>
                    );
                  };

                  return (
                    <Card key="hours-chart">
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                        Where Your Paid Hours Actually Go
                      </div>
                      <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 4, lineHeight: 1.6 }}>
                        Traditional centers pay for every scheduled hour — only a portion reaches a customer.
                        ShyftOff bills productive hours only. Same output, zero waste.
                      </div>
                      <div style={{ fontSize: 10, color: "#4a4855", marginBottom: 16, lineHeight: 1.6 }}>
                        <span style={{ color: "#6d28d9" }}>In-center ({inputs.inCenterShrink}%)</span>: breaks, lunch rotations, coaching, system downtime — agent present, off-phones.&nbsp;
                        <span style={{ color: "#8b5cf6" }}>Out-of-center ({inputs.outOfCenterShrink}%)</span>: training, vacation, sick/FMLA — agent absent.&nbsp;
                        Schedule inefficiency = shift-block over-coverage (agents available but not needed).
                        Adjust either input above to update.
                      </div>
                      <ResponsiveContainer width="100%" height={340}>
                        <BarChart data={hoursData} margin={{ top: 44, right: 130, left: 10, bottom: 50 }} barCategoryGap="35%">
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1f2e" vertical={false} />
                          <XAxis dataKey="name" tick={<CustomTick />} height={52} />
                          <YAxis
                            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                            tick={{ fill: "#6b6878", fontSize: 11 }}
                            label={{ value: "Hrs / Month", angle: -90, position: "insideLeft", fill: "#4a4855", fontSize: 11, dx: -5 }}
                          />
                          <Tooltip
                            formatter={(v, name) => v > 0 ? [`${Math.round(v).toLocaleString()} hrs`, name] : null}
                            labelStyle={{ color: "#fff" }}
                            contentStyle={{ background: "#13141a", border: "1px solid #2a2b3d" }}
                          />
                          <Legend
                            verticalAlign="bottom" wrapperStyle={{ paddingTop: 12 }}
                            formatter={(value) => <span style={{ color: "#8a8891", fontSize: 11 }}>{value}</span>}
                          />
                          <ReferenceLine y={productive} stroke="#3a3b4d" strokeDasharray="5 3"
                            label={{ value: "← same productive output", position: "right", fill: "#4a4855", fontSize: 10 }} />

                          {/* 1 — Productive (bottom, both bars) */}
                          <Bar dataKey="Productive" stackId="a" name="Productive" fill="#4c1d95" radius={[0,0,4,4]}>
                            <LabelList content={({ x, y, width, height, value }) => {
                              if (!value || height < 50) return null;
                              return (
                                <g>
                                  <text x={x+width/2} y={y+height/2-8} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={12} fontWeight={700}>
                                    {Math.round(value).toLocaleString()} hrs
                                  </text>
                                  <text x={x+width/2} y={y+height/2+8} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={10}>
                                    Productive
                                  </text>
                                </g>
                              );
                            }} />
                            {/* Above-bar annotation for ShyftOff (Productive is its only / topmost segment) */}
                            <LabelList position="top" content={({ x, y, width, index }) => {
                              if (index !== 1) return null;
                              return (
                                <g>
                                  <text x={x+width/2} y={y-18} textAnchor="middle" fill="#22c55e" fontSize={10} fontWeight={600}>(0% waste)</text>
                                  <text x={x+width/2} y={y-4} textAnchor="middle" fill="#e2e0e7" fontSize={12} fontWeight={700}>
                                    {productive.toLocaleString()} paid hrs
                                  </text>
                                </g>
                              );
                            }} />
                          </Bar>

                          {/* 2 — In-Center Shrinkage (breaks, lunch, coaching — agent present, off-phones) */}
                          <Bar dataKey="In-Center Shrinkage" stackId="a" name="In-Center Shrinkage" fill="#6d28d9">
                            <LabelList dataKey="In-Center Shrinkage" content={segLabel} />
                          </Bar>

                          {/* 3 — Out-of-Center Shrinkage (training, vacation, sick — agent absent) */}
                          <Bar dataKey="Out-of-Center Shrinkage" stackId="a" name="Out-of-Center Shrinkage" fill="#8b5cf6">
                            <LabelList dataKey="Out-of-Center Shrinkage" content={segLabel} />
                          </Bar>

                          {/* 4 — Schedule Inefficiency (shift-block overstaffing — agent available but not needed) */}
                          <Bar dataKey="Schedule Inefficiency" stackId="a" name="Schedule Inefficiency" fill="#c4b5fd" radius={[4,4,0,0]}>
                            <LabelList dataKey="Schedule Inefficiency" content={segLabel} />
                            {/* Above-bar annotation for Traditional (Schedule Inefficiency is its topmost segment) */}
                            <LabelList position="top" content={({ x, y, width, index }) => {
                              if (index !== 0) return null;
                              const d = hoursData[0];
                              return (
                                <g>
                                  <text x={x+width/2} y={y-18} textAnchor="middle" fill="#ef4444" fontSize={10} fontWeight={600}>
                                    ({d.wastePct}% waste)
                                  </text>
                                  <text x={x+width/2} y={y-4} textAnchor="middle" fill="#e2e0e7" fontSize={12} fontWeight={700}>
                                    {d.total.toLocaleString()} paid hrs
                                  </text>
                                </g>
                              );
                            }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                  );
                })()}

                {/* Key metrics row — content shifts based on showAI */}
                <div className="calc-metrics-row" style={{
                  display: "grid",
                  gridTemplateColumns: showAI ? "repeat(3, 1fr)" : "repeat(2, 1fr)",
                  gap: 12,
                }}>
                  {(showAI ? [
                    { label: "Cost per Resolved Contact", values: [
                      { s: "Trad (no AI)", v: fmtCurD(results.cprc.preTraditional, 2), c: "#ef4444" },
                      { s: "ShyftOff (no AI)", v: fmtCurD(results.cprc.preGig, 2), c: "#f59e0b" },
                      { s: "ShyftOff + AI", v: fmtCurD(results.cprc.postGig, 2), c: "#22c55e" },
                    ]},
                    { label: "AI Handled This Month", values: [
                      { s: "Calls resolved by AI", v: fmt(results.s3AIHandledCalls), c: "#a855f7" },
                      { s: "AI monthly cost", v: fmtCur(results.s3AIMonthlyCost), c: "#8b5cf6" },
                      { s: "Cost per AI resolution", v: fmtCurD(results.s3AIMonthlyCost / (results.s3AIHandledCalls || 1), 3), c: "#6366f1" },
                    ]},
                    { label: "Human Volume Post-AI", values: [
                      { s: "Residual human calls", v: fmt(results.humanVolumePostAI), c: "#06b6d4" },
                      { s: "Avg handle time", v: `${fmtD(results.humanAHTPostAI, 1)} min`, c: "#06b6d4" },
                      { s: "FTE required", v: fmtD(results.avgFTEPostTrad, 0), c: "#06b6d4" },
                    ]},
                  ] : [
                    { label: "Cost per Resolved Contact", values: [
                      { s: "Traditional", v: fmtCurD(results.cprc.preTraditional, 2), c: "#ef4444" },
                      { s: "ShyftOff", v: fmtCurD(results.cprc.preGig, 2), c: "#22c55e" },
                      { s: "Savings per contact", v: fmtCurD(results.cprc.preTraditional - results.cprc.preGig, 2), c: "#a855f7" },
                    ]},
                    { label: "Traditional Cost Stack", values: [
                      { s: "Sup / Mgr / WFM", v: `${results.s1.supCount} / ${results.s1.mgrCount} / ${results.s1.wfmCount}`, c: "#f59e0b" },
                      { s: "Support cost / mo", v: fmtCur(results.s1.supportCostMonthly), c: "#f59e0b" },
                      { s: "Workstation / mo", v: fmtCur(results.s1.workstationCostMonthly), c: "#f59e0b" },
                    ]},
                  ]).map(({ label, values }) => (
                    <Card key={label}>
                      <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 12, fontWeight: 600 }}>{label}</div>
                      {values.map(({ s, v, c }) => (
                        <div key={s} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "baseline" }}>
                          <span style={{ fontSize: 11, color: "#6b6878" }}>{s}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: c, fontFamily: "Space Mono, monospace" }}>{v}</span>
                        </div>
                      ))}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* ══ TAB 2: STAFFING IMPACT ════════════════════════════════════════ */}
            {activeTab === "staffing" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                {/* Volatility callout — AI-specific, hidden in classic mode */}
                {showAI && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {[
                      { label: "Pre-AI Demand Variability", value: `${fmtD(results.preCV * 100, 1)}%`, sub: "Coefficient of Variation", color: "#f59e0b" },
                      { label: "Post-AI Demand Variability", value: `${fmtD(results.postCV * 100, 1)}%`, sub: "Coefficient of Variation", color: "#ef4444" },
                      { label: "Volatility Multiplier", value: `${fmtD(results.cvMultiplier, 1)}×`, sub: "harder to staff with FTE", color: "#a855f7" },
                    ].map(({ label, value, sub, color }) => (
                      <Card key={label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 8 }}>{label}</div>
                        <div style={{ fontSize: 32, fontWeight: 800, color, fontFamily: "Space Mono, monospace" }}>{value}</div>
                        <div style={{ fontSize: 11, color: "#4a4855", marginTop: 4 }}>{sub}</div>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Intraday Pre/Post-AI demand chart — AI-specific */}
                {showAI && (
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Intraday Demand: Pre-AI vs Post-AI Human Demand
                  </div>
                  <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                    Peak day. Post-AI demand is lower but more volatile — traditional shift blocks can't flex with it.
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={results.intervalChart} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <defs>
                        <linearGradient id="preGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="postGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1f2e" />
                      <XAxis dataKey="label" tick={{ fill: "#6b6878", fontSize: 10 }}
                        interval={3} />
                      <YAxis tick={{ fill: "#6b6878", fontSize: 11 }} label={{ value: "Agents", angle: -90, position: "insideLeft", fill: "#4a4855", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "#13141a", border: "1px solid #2a2b3d" }}
                        labelStyle={{ color: "#fff" }} formatter={(v) => [fmt(v), ""]} />
                      <Legend wrapperStyle={{ fontSize: 12, color: "#8a8891" }} />
                      <Area type="monotone" dataKey="Pre-AI Demand" stroke="#ef4444" strokeWidth={2}
                        fill="url(#preGrad)" dot={false} />
                      <Area type="monotone" dataKey="Post-AI Human Demand" stroke="#a855f7" strokeWidth={2}
                        fill="url(#postGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
                )}

                {/* FTE comparison table */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 16 }}>
                    Staffing Requirements by Scenario
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {(showAI
                            ? ["Metric", "Pre-AI Traditional", "Pre-AI ShyftOff", "Post-AI Traditional", "Post-AI ShyftOff"]
                            : ["Metric", "Traditional", "ShyftOff"]
                          ).map((h, i) => (
                            <th key={h} style={{
                              textAlign: i === 0 ? "left" : "right", padding: "8px 12px",
                              color: "#6b6878", fontWeight: 600, borderBottom: "1px solid #1e1f2e",
                              fontSize: 11,
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(showAI ? [
                          { label: "Human Call Volume", vals: [
                            fmt(inputs.monthlyVolume), fmt(inputs.monthlyVolume),
                            fmt(Math.round(results.humanVolumePostAI)), fmt(Math.round(results.humanVolumePostAI)),
                          ]},
                          { label: "Avg Handle Time", vals: [
                            `${inputs.aht} min`, `${inputs.aht} min`,
                            `${fmtD(results.humanAHTPostAI, 1)} min`, `${fmtD(results.humanAHTPostAI, 1)} min`,
                          ]},
                          { label: "Required FTE (avg)", vals: [
                            fmtD(results.avgFTEPreTrad, 0), fmtD(results.avgFTEPreTrad, 0),
                            fmtD(results.avgFTEPostTrad, 0), fmtD(results.avgFTEPostTrad, 0),
                          ]},
                          { label: "Monthly Staffing Cost", vals: [
                            fmtCur(results.preTraditional), fmtCur(results.preGig),
                            fmtCur(results.s3.traditionalCost), fmtCur(results.s4.gigCost),
                          ]},
                          { label: "+ AI Cost", vals: ["—", "—", fmtCur(results.s3AIMonthlyCost), fmtCur(results.s3AIMonthlyCost)] },
                          { label: "Total Monthly Cost", vals: [
                            fmtCur(results.preTraditional), fmtCur(results.preGig),
                            fmtCur(results.postTraditional), fmtCur(results.postGig),
                          ], bold: true },
                        ] : (() => {
                          // Gig FTE-equivalent from billed productive hours (40 hrs/wk × 4.33 wks/mo)
                          const FTE_HRS_PER_MONTH = 40 * 4.33;
                          const gigFTE = results.s1.monthlyRequiredHours / FTE_HRS_PER_MONTH;
                          // Gig peak = max concurrent agents needed in any 30-min interval on the peak day
                          const gigPeak = results.s1.intervals.length
                            ? Math.max(...results.s1.intervals.map((iv) => iv.required))
                            : 0;
                          return [
                            { label: "Monthly Call Volume", vals: [fmt(inputs.monthlyVolume), fmt(inputs.monthlyVolume)] },
                            { label: "Avg Handle Time", vals: [`${inputs.aht} min`, `${inputs.aht} min`] },
                            { label: "Avg FTE", vals: [fmtD(results.avgFTEPreTrad, 0), fmtD(gigFTE, 0)] },
                            { label: "Peak concurrent agents", vals: [fmt(results.s1.peakTradAgents), fmt(gigPeak)] },
                            { label: "Sup / Mgr / WFM", vals: [`${results.s1.supCount} / ${results.s1.mgrCount} / ${results.s1.wfmCount}`, "0 / 0 / 0"] },
                            { label: "Workstation cost / mo", vals: [fmtCur(results.s1.workstationCostMonthly), "$0"] },
                            { label: "Total Monthly Cost", vals: [fmtCur(results.preTraditional), fmtCur(results.preGig)], bold: true },
                          ];
                        })()).map(({ label, vals, bold }) => (
                          <tr key={label} style={{ borderBottom: "1px solid #1a1b26" }}>
                            <td style={{ padding: "9px 12px", color: bold ? "#fff" : "#8a8891", fontWeight: bold ? 700 : 400 }}>{label}</td>
                            {vals.map((v, i) => (
                              <td key={i} style={{
                                padding: "9px 12px", textAlign: "right",
                                color: bold
                                  ? (showAI
                                    ? (i === 2 ? "#ef4444" : i === 3 ? "#22c55e" : "#e2e0e7")
                                    : (i === 0 ? "#ef4444" : "#22c55e"))
                                  : "#8a8891",
                                fontWeight: bold ? 700 : 400,
                                fontFamily: "Space Mono, monospace",
                              }}>{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* ── Staffing Inflexibility Chart ── */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Staffing Levels Throughout the Day — {showAI ? "Post-AI Traditional (Residual Demand)" : "Traditional Center"}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                    <span style={{ color: "#3b82f6", fontWeight: 600 }}>Scheduled</span> = heads-in-seats from shift blocks &nbsp;|&nbsp;
                    <span style={{ color: "#f59e0b", fontWeight: 600 }}>In Center</span> = bodies present (scheduled − out-of-center) &nbsp;|&nbsp;
                    <span style={{ color: "#ef4444", fontWeight: 600 }}>Required</span> = raw Erlang C (on-phones demand) &nbsp;|&nbsp;
                    <span style={{ color: "#22c55e", fontWeight: 600 }}>On-Phones</span> = actually delivered after breaks/lunches
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={results.staffingChartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <defs>
                        <linearGradient id="schedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1f2e" />
                      <XAxis dataKey="label" tick={{ fill: "#6b6878", fontSize: 10 }} interval={3} />
                      <YAxis tick={{ fill: "#6b6878", fontSize: 11 }}
                        label={{ value: "Agents", angle: -90, position: "insideLeft", fill: "#4a4855", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "#13141a", border: "1px solid #2a2b3d" }}
                        labelStyle={{ color: "#fff" }} formatter={(v, n) => [fmt(v), n]} />
                      <Legend wrapperStyle={{ fontSize: 12, color: "#8a8891" }} />
                      <Area type="stepAfter" dataKey="Scheduled (Shifts)" stroke="#3b82f6" strokeWidth={2.5}
                        fill="url(#schedGrad)" dot={false} />
                      <Area type="stepAfter" dataKey="In Center" stroke="#f59e0b" strokeWidth={2}
                        fill="none" dot={false} strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="Required (Erlang C)" stroke="#ef4444" strokeWidth={2}
                        fill="url(#reqGrad)" dot={false} strokeDasharray="6 3" />
                      <Area type="monotone" dataKey="Actual On-Phones" stroke="#22c55e" strokeWidth={2}
                        fill="none" dot={false} strokeDasharray="4 4" />
                    </AreaChart>
                  </ResponsiveContainer>

                  {/* Over/under heatmap strip — one cell per 30-min interval.
                      paddingLeft/Right match Recharts' plot area so cells line
                      up with the chart's x-axis ticks above. */}
                  <div className="calc-heatmap-strip" style={{ marginTop: 6, paddingLeft: 55, paddingRight: 20 }}>
                    <div style={{ fontSize: 10, color: "#6b6878", fontWeight: 600, marginBottom: 4,
                      textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Per-interval On-Phones vs Required (the SL story)
                    </div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${results.staffingChartData.length}, 1fr)`,
                      gap: 2,
                    }}>
                      {results.staffingChartData.map((d, i) => {
                        // Compare ACTUAL on-phones delivered to RAW Erlang C
                        // requirement (both are on-phones-basis, apples to
                        // apples). This is the gap callers actually feel —
                        // surplus on-phones = SL exceeds target; deficit =
                        // SL drops + abandonment rises.
                        const net = d["Actual On-Phones"] - d["Required (Erlang C)"];
                        const required = d["Required (Erlang C)"] || 1;
                        const ratio = net / required; // signed fraction
                        const bg = net > 0
                          ? `rgba(34, 197, 94, ${Math.min(0.85, 0.25 + Math.abs(ratio))})` // green for over
                          : net < 0
                            ? `rgba(239, 68, 68, ${Math.min(0.9, 0.3 + Math.abs(ratio))})` // red for under
                            : "rgba(245, 158, 11, 0.55)"; // amber for at-target
                        const label = net === 0 ? "0" : (net > 0 ? `+${net}` : `${net}`);
                        return (
                          <div key={i} title={`${d.label} · net ${label}`}
                            style={{
                              background: bg, height: 24, borderRadius: 3, cursor: "default",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 11, fontWeight: 700, color: "#0a0b0f",
                              fontFamily: "'Space Mono', monospace",
                            }}>
                            {label}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4,
                      fontSize: 10, color: "#4a4855", fontFamily: "Space Mono, monospace" }}>
                      <span>{results.staffingChartData[0]?.label ?? ""}</span>
                      <span>{results.staffingChartData[Math.floor(results.staffingChartData.length / 2)]?.label ?? ""}</span>
                      <span>{results.staffingChartData[results.staffingChartData.length - 1]?.label ?? ""}</span>
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 10, color: "#6b6878" }}>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(239,68,68,0.7)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Understaffed</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(245,158,11,0.45)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />At target</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(34,197,94,0.6)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Overstaffed</span>
                    </div>
                  </div>
                </Card>

                {/* ── Shift Waste Warning ── */}
                <div style={{
                  background: "linear-gradient(135deg, #1a100e 0%, #140b0a 100%)",
                  border: "1px solid #ef4444", borderRadius: 10, padding: "14px 20px",
                  display: "flex", alignItems: "center", gap: 16,
                }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>⏳</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", marginBottom: 3 }}>
                      {showAI
                        ? "Even Smaller AI-Residual Volume Costs This Much — Volatility Forces Over-Coverage"
                        : "Paying for Every Scheduled Hour — Including Shrinkage and Coverage Gaps"}
                    </div>
                    <div style={{ fontSize: 12, color: "#8a8891", lineHeight: 1.5 }}>
                      {showAI ? (
                        <>The post-AI residual stream is choppier (higher CV) than the pre-AI
                        baseline. Traditional fixed shifts still carry full shrinkage plus
                        over-coverage to absorb the bumps. You pay every scheduled hour even
                        though AI handled most of the predictable load.</>
                      ) : (
                        <>Even a well-scheduled traditional center carries unavoidable inefficiency:
                        35% shrinkage (breaks, lunch, training, PTO) plus residual shift-geometry
                        mismatch at the edges. You pay every scheduled hour regardless.</>
                      )}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#ef4444", fontFamily: "Space Mono, monospace" }}>
                      {fmtD(results.totalInefficiencyHrsDay, 0)} hrs/day
                    </div>
                    <div style={{ fontSize: 11, color: "#6b6878", marginTop: 2 }}>
                      {fmtCur(results.totalInefficiencyCostMonth)}/mo lost to inefficiency
                    </div>
                  </div>
                </div>

                {/* ── Shift Table ── */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Shift-Block Scheduling Inefficiency — Per Shift Breakdown
                  </div>
                  <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                    {showAI
                      ? "Post-AI traditional schedule (residual demand after AI containment). Every shift still carries shrinkage plus over-coverage to absorb the noisier residual stream."
                      : "Pre-AI traditional baseline. Every shift carries inefficiency from shrinkage (breaks, lunch, training, PTO) plus any over-coverage above its proportional demand share."}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Shift", "Window", "Agents", "Avg Needed", "Utilization", "Inefficiency Hrs/Day", "Inefficiency Cost/Mo"].map((h, i) => (
                            <th key={h} style={{
                              textAlign: i <= 1 ? "left" : "right",
                              padding: "8px 12px", color: "#6b6878", fontWeight: 600,
                              borderBottom: "1px solid #1e1f2e", fontSize: 11, whiteSpace: "nowrap",
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.shiftTableRows.map((row) => (
                          <tr key={row.name} style={{ borderBottom: "1px solid #1a1b26" }}>
                            <td style={{ padding: "9px 12px", color: "#8a8891" }}>{row.name}</td>
                            <td style={{ padding: "9px 12px", color: "#6b6878", fontFamily: "Space Mono, monospace", fontSize: 11 }}>{row.window}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#3b82f6", fontWeight: 700, fontFamily: "Space Mono, monospace" }}>{row.agents}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#8a8891", fontFamily: "Space Mono, monospace" }}>{row.avgNeeded}</td>
                            <td style={{ padding: "9px 12px", minWidth: 120 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                                <div style={{ width: 60, height: 6, background: "#1e1f2e", borderRadius: 3, overflow: "hidden" }}>
                                  <div style={{
                                    width: `${Math.min(row.utilizationPct, 100)}%`, height: "100%",
                                    background: row.utilizationPct >= 80 ? "#22c55e" : row.utilizationPct >= 60 ? "#f59e0b" : "#ef4444",
                                    borderRadius: 3,
                                  }} />
                                </div>
                                <span style={{ fontSize: 11, color: "#8a8891", fontFamily: "Space Mono, monospace", minWidth: 36, textAlign: "right" }}>
                                  {fmtD(row.utilizationPct, 0)}%
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#f59e0b", fontFamily: "Space Mono, monospace" }}>
                              {fmtD(row.inefficiencyHrsDay, 1)}
                            </td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#ef4444", fontFamily: "Space Mono, monospace" }}>
                              {fmtCur(row.inefficiencyCostMonth)}
                            </td>
                          </tr>
                        ))}
                        {/* Total row */}
                        <tr style={{ borderTop: "2px solid #2a2b3d", background: "#0d0e14" }}>
                          <td colSpan={5} style={{ padding: "10px 12px", color: "#fff", fontWeight: 700, fontSize: 12 }}>
                            Total Shift Inefficiency
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#f59e0b", fontWeight: 700, fontFamily: "Space Mono, monospace" }}>
                            {fmtD(results.totalInefficiencyHrsDay, 1)}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#ef4444", fontWeight: 700, fontFamily: "Space Mono, monospace", fontSize: 14 }}>
                            {fmtCur(results.totalInefficiencyCostMonth)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Sensitivity chart — volume sweep (classic) or containment sweep (AI) */}
                {showAI ? (
                  <Card>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                      Sensitivity Analysis: Total Cost by Containment Rate
                    </div>
                    <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                      The amber dashed line is what buyers <em>assume</em> they'll get (linear cut). The gap to Trad + AI is real traditional-center overhead AI can't displace — shrinkage, shift bloat, supervisor ratios, residual SL floor.
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={results.sensitivityData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1f2e" />
                        <XAxis dataKey="containment" tick={{ fill: "#6b6878", fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#6b6878", fontSize: 11 }} />
                        <Tooltip formatter={(v) => fmtCur(v)} contentStyle={{ background: "#13141a", border: "1px solid #2a2b3d" }} />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#8a8891" }} />
                        <Line type="monotone" dataKey="Traditional + AI" stroke="#ef4444" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="ShyftOff + AI" stroke="#a855f7" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="Trad (no AI)" stroke="#4a4855" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                        <Line type="monotone" dataKey="Naive Linear Estimate" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="2 4" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                ) : (
                  <Card>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                      Sensitivity Analysis: Total Cost by Call Volume
                    </div>
                    <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                      As volume grows, ShyftOff savings compound — Traditional loaded wages and support overhead create a steeper cost curve
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={results.volumeSweepData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1f2e" />
                        <XAxis dataKey="label" tick={{ fill: "#6b6878", fontSize: 11 }} />
                        <YAxis
                          tickFormatter={(v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}k`}
                          tick={{ fill: "#6b6878", fontSize: 11 }} width={58}
                        />
                        <Tooltip
                          formatter={(v, name) => [fmtCur(v), name]}
                          labelFormatter={(l) => `${l} calls / mo`}
                          labelStyle={{ color: "#fff" }}
                          contentStyle={{ background: "#13141a", border: "1px solid #2a2b3d" }}
                        />
                        <ReferenceLine
                          x={results.volumeSweepData[3]?.label}
                          stroke="#3a3b4d" strokeDasharray="4 4"
                          label={{ value: "current", fill: "#4a4855", fontSize: 10, position: "insideTopRight" }}
                        />
                        <Line type="monotone" dataKey="Traditional" stroke="#ef4444" strokeWidth={2.5}
                          dot={{ r: 3, fill: "#ef4444", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="ShyftOff" stroke="#a855f7" strokeWidth={2.5}
                          dot={{ r: 3, fill: "#a855f7", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                        <Legend formatter={(v) => <span style={{ color: "#a0a0b0", fontSize: 11 }}>{v}</span>} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                )}
              </div>
            )}

            {/* ══ TAB 3: AI COST STACK ══════════════════════════════════════════ */}
            {activeTab === "ai-costs" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                {/* Component breakdown bars */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    AI Cost Stack — Per-Minute Breakdown
                  </div>
                  <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 20 }}>
                    Every component driving your AI agent cost per minute
                  </div>
                  {results.aiStack.map(({ name, value, color }) => {
                    const pct = results.aiCostBase > 0 ? value / results.aiCostBase : 0;
                    return (
                      <div key={name} style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 12, color: "#8a8891" }}>{name}</span>
                          <div style={{ display: "flex", gap: 16 }}>
                            <span style={{ fontSize: 12, color: "#4a4855" }}>{fmtD(pct * 100, 1)}%</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "Space Mono, monospace" }}>
                              {fmtCurD(value, 4)}/min
                            </span>
                          </div>
                        </div>
                        <div style={{ height: 8, background: "#1e1f2e", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{
                            width: `${Math.min(pct * 100, 100)}%`, height: "100%",
                            background: color, borderRadius: 4, transition: "width 0.4s ease",
                          }} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ borderTop: "1px solid #1e1f2e", marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "#8a8891" }}>Subtotal</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#a855f7", fontFamily: "Space Mono, monospace" }}>
                      {fmtCurD(results.aiCostBase, 4)}/min
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 12, color: "#8a8891" }}>+ {inputs.aiFailureBuffer}% failure buffer</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#a855f7", fontFamily: "Space Mono, monospace" }}>
                      {fmtCurD(results.aiCostPerMin, 4)}/min
                    </span>
                  </div>
                </Card>

                {/* Per-call costs */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card>
                    <div style={{ fontSize: 12, color: "#6b6878", marginBottom: 14, fontWeight: 600 }}>Per-Call AI Economics</div>
                    {[
                      { label: `AI cost / ${inputs.aht}-min call`, value: fmtCurD(results.aiCostPerMin * inputs.aht, 3), color: "#a855f7" },
                      { label: "AI cost / resolved contact", value: fmtCurD(results.s3AIMonthlyCost / (results.s3AIHandledCalls || 1), 3), color: "#8b5cf6" },
                      { label: "Human cost / contact (trad)", value: fmtCurD(results.cprc.preTraditional, 2), color: "#ef4444" },
                      { label: "Human cost / contact (gig)", value: fmtCurD(results.cprc.preGig, 2), color: "#f59e0b" },
                      { label: "AI + gig blended / contact", value: fmtCurD(results.cprc.postGig, 2), color: "#22c55e" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: "#6b6878" }}>{label}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "Space Mono, monospace" }}>{value}</span>
                      </div>
                    ))}
                  </Card>
                  <Card>
                    <div style={{ fontSize: 12, color: "#6b6878", marginBottom: 14, fontWeight: 600 }}>Monthly AI Cost Roll-up</div>
                    {[
                      { label: "AI-handled calls", value: fmt(results.s3AIHandledCalls), color: "#a855f7" },
                      { label: "AI-handled minutes", value: fmt(results.s3AIHandledCalls * inputs.aht), color: "#8b5cf6" },
                      { label: "Total AI cost/month", value: fmtCur(results.s3AIMonthlyCost), color: "#a855f7" },
                      { label: "As % of total cost (ShyftOff)", value: `${fmtD(results.s3AIMonthlyCost / (results.postGig || 1) * 100, 1)}%`, color: "#6366f1" },
                      { label: "Containment rate", value: `${Math.round(inputs.containmentRate * 100)}%`, color: "#06b6d4" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: "#6b6878" }}>{label}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "Space Mono, monospace" }}>{value}</span>
                      </div>
                    ))}
                  </Card>
                </div>

                {/* Benchmark comparison */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Market Rate Benchmarks
                  </div>
                  <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                    Where your configured rate lands vs. industry pricing tiers
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {Object.entries(TIER_PRESETS).map(([key, preset]) => {
                      const active = selectedTier === key;
                      return (
                        <div key={key} onClick={() => applyPreset(key)} style={{
                          background: active ? "#1a1228" : "#0d0e14",
                          border: `1px solid ${active ? preset.color : "#1e1f2e"}`,
                          borderRadius: 8, padding: "14px 14px", cursor: "pointer",
                          transition: "all 0.15s",
                          boxShadow: active ? `0 0 16px ${preset.color}22` : "none",
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: preset.color, marginBottom: 4 }}>
                            {preset.label}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", fontFamily: "Space Mono, monospace", marginBottom: 6 }}>
                            {preset.range}<span style={{ fontSize: 10, color: "#4a4855" }}>/min</span>
                          </div>
                          <div style={{ fontSize: 11, color: "#6b6878", lineHeight: 1.5 }}>{preset.desc}</div>
                          <div style={{ marginTop: 10, fontSize: 10, color: "#4a4855" }}>{preset.vendors}</div>
                          {active && (
                            <div style={{
                              marginTop: 10, display: "inline-flex", alignItems: "center", gap: 5,
                              background: `${preset.color}22`, border: `1px solid ${preset.color}`,
                              borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: preset.color,
                            }}>
                              ✓ Applied
                            </div>
                          )}
                          {!active && (
                            <div style={{ marginTop: 10, fontSize: 10, color: "#4a4855" }}>
                              Click to apply →
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {/* ══ TAB 4: SUMMARY ════════════════════════════════════════════════ */}
            {activeTab === "summary" && (() => {
              const classicAnnualSavings = (results.preTraditional - results.preGig) * 12;
              const classicSavingsPct = results.preTraditional > 0
                ? (results.preTraditional - results.preGig) / results.preTraditional
                : 0;
              const heroSavings = showAI ? results.annualSavings : classicAnnualSavings;
              const heroPct = showAI ? results.savingsPct : classicSavingsPct;
              return (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                {/* Hero metric */}
                <div style={{
                  background: "linear-gradient(135deg, #1a1228 0%, #0f0a1e 100%)",
                  border: "1px solid #a855f7", borderRadius: 14,
                  padding: "28px 32px", textAlign: "center",
                  boxShadow: "0 0 40px rgba(168,85,247,0.12)",
                }}>
                  <div style={{ fontSize: 12, color: "#8a8891", marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {showAI ? "Annual savings vs. Traditional (no AI)" : "Annual savings vs. Traditional"}
                  </div>
                  <div style={{ fontSize: 56, fontWeight: 900, color: "#22c55e", fontFamily: "Space Mono, monospace", lineHeight: 1 }}>
                    {fmtCur(heroSavings)}
                  </div>
                  <div style={{ fontSize: 16, color: "#a855f7", marginTop: 8, fontWeight: 600 }}>
                    {fmtD(heroPct * 100, 1)}% reduction in total contact center cost
                  </div>
                  <div style={{ fontSize: 12, color: "#4a4855", marginTop: 6 }}>
                    {showAI
                      ? "ShyftOff + AI vs. Traditional with no automation"
                      : "ShyftOff vs. Traditional contact center staffing"}
                  </div>
                </div>

                {/* Savings waterfall */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Where the Savings Come From
                  </div>
                  <div style={{ fontSize: 11, color: "#6b6878", marginBottom: 16 }}>
                    {showAI
                      ? "Monthly cost waterfall: baseline → gig savings → AI savings → total"
                      : "Monthly cost waterfall: traditional baseline → gig savings → total"}
                  </div>
                  {(() => {
                    const gigSavings = results.preTraditional - results.preGig;
                    const steps = showAI ? [
                      { label: "Traditional (no AI)", value: results.preTraditional, type: "base", color: "#ef4444" },
                      { label: "ShyftOff flexibility savings", value: -gigSavings, type: "save", color: "#22c55e" },
                      { label: "AI containment savings", value: -(results.preGig - results.s4.gigCost), type: "save", color: "#a855f7" },
                      { label: "AI infrastructure cost", value: results.s3AIMonthlyCost, type: "cost", color: "#f59e0b" },
                      { label: "ShyftOff + AI (total)", value: results.postGig, type: "total", color: "#22c55e" },
                    ] : [
                      { label: "Traditional", value: results.preTraditional, type: "base", color: "#ef4444" },
                      { label: "ShyftOff flexibility savings", value: -gigSavings, type: "save", color: "#22c55e" },
                      { label: "ShyftOff (total)", value: results.preGig, type: "total", color: "#22c55e" },
                    ];
                    return steps.map(({ label, value, type, color }) => (
                      <div key={label} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 12, color: "#8a8891" }}>{label}</span>
                          <span style={{
                            fontSize: 13, fontWeight: 700, fontFamily: "Space Mono, monospace",
                            color: type === "save" ? "#22c55e" : type === "cost" ? "#f59e0b" : color,
                          }}>
                            {type === "save" ? "−" : type === "cost" ? "+" : ""}{fmtCur(Math.abs(value))}
                          </span>
                        </div>
                        <div style={{ height: 10, background: "#1e1f2e", borderRadius: 5, overflow: "hidden" }}>
                          <div style={{
                            width: `${Math.min(Math.abs(value) / results.preTraditional * 100, 100)}%`,
                            height: "100%", background: color, borderRadius: 5, transition: "width 0.4s",
                          }} />
                        </div>
                      </div>
                    ));
                  })()}
                </Card>

                {/* Key assumptions */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 14 }}>Key Assumptions</div>
                    {(showAI ? [
                      ["Monthly volume", fmt(inputs.monthlyVolume) + " calls"],
                      ["Base AHT", inputs.aht + " min"],
                      ["Post-AI AHT", fmtD(results.humanAHTPostAI, 1) + " min"],
                      ["AI containment", Math.round(inputs.containmentRate * 100) + "%"],
                      ["Escalation rate", Math.round(inputs.escalationRate * 100) + "%"],
                      ["Blended AI cost", fmtCurD(results.aiCostPerMin, 4) + "/min"],
                      ["Human rate (trad, pre-AI)", "$" + inputs.traditionalRate + "/hr + " + inputs.benefitsMultiplier + "% benefits"],
                      ["Human rate (trad, post-AI)", "$" + fmtD(inputs.traditionalRate * (1 + inputs.postAiWagePremium / 100), 2) + "/hr (+" + inputs.postAiWagePremium + "% premium)"],
                      ["ShyftOff rate", "$" + fmtD(results.s1.gigRate, 2) + "/hr (productive only)"],
                    ] : [
                      ["Monthly volume", fmt(inputs.monthlyVolume) + " calls"],
                      ["Avg Handle Time", inputs.aht + " min"],
                      ["Hours of operation", `${formatHourLabel(inputs.startHour).replace(/ \(.*\)$/, "")} – ${formatHourLabel(inputs.endHour).replace(/ \(.*\)$/, "")}`],
                      ["Service level target", `${inputs.serviceLevelTarget}% in ${inputs.serviceLevelThreshold}s`],
                      ["Human rate (loaded)", "$" + fmtD(inputs.traditionalRate * (1 + inputs.benefitsMultiplier / 100), 2) + "/hr"],
                      ["ShyftOff rate", "$" + fmtD(results.s1.gigRate, 2) + "/hr (productive only)"],
                      ["Sup / Mgr / WFM headcount", `${results.s1.supCount} / ${results.s1.mgrCount} / ${results.s1.wfmCount}`],
                      ["Workstation cost / mo", fmtCur(results.s1.workstationCostMonthly)],
                      ["Arrival pattern", ARRIVAL_PRESETS[arrivalKey].label],
                    ]).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                        <span style={{ fontSize: 11, color: "#6b6878" }}>{k}</span>
                        <span style={{ fontSize: 11, color: "#e2e0e7", fontFamily: "Space Mono, monospace" }}>{v}</span>
                      </div>
                    ))}
                  </Card>
                  <Card>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 14 }}>The ShyftOff Advantage</div>
                    {(showAI ? [
                      { point: "No idle labor cost", desc: "Gig agents paid for productive intervals only — no shrinkage waste, no shift bloat." },
                      { point: "Flex with AI volatility", desc: "Post-AI demand is 2–3× more volatile. Gig scales up/down in real time; FTE can't." },
                      { point: "Higher-caliber agents", desc: "Complex escalations need skilled agents. ShyftOff's model attracts experienced workers." },
                      { point: "Zero AI deployment risk", desc: "If AI underperforms, gig capacity absorbs the overflow without headcount panic." },
                    ] : [
                      { point: "No idle labor cost", desc: "Gig agents are paid for productive intervals only — no shrinkage waste, no shift-block bloat." },
                      { point: "No support overhead", desc: "Skip the sup / mgr / WFM headcount and the workstation amortization. ShyftOff includes the platform layer." },
                      { point: "Flex with real demand", desc: "30-min granularity tracks your arrival curve. Traditional shifts can't reshape mid-day." },
                      { point: "Higher-caliber agents", desc: "ShyftOff's model attracts experienced workers without the high turnover of traditional contact center centers." },
                    ]).map(({ point, desc }) => (
                      <div key={point} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#a855f7", marginBottom: 2 }}>{point}</div>
                        <div style={{ fontSize: 11, color: "#6b6878", lineHeight: 1.5 }}>{desc}</div>
                      </div>
                    ))}
                  </Card>
                </div>

                {/* CTA */}
                <div style={{
                  background: "linear-gradient(135deg, #1a1228 0%, #160d24 100%)",
                  border: "1px solid #a855f7", borderRadius: 12, padding: "24px 28px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 20,
                }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
                      Ready to capture {fmtCur(heroSavings)} in annual savings?
                    </div>
                    <div style={{ fontSize: 13, color: "#8a8891" }}>
                      {showAI
                        ? "ShyftOff provides the flexible gig workforce that makes AI economics work. Talk to our team about your deployment strategy."
                        : "ShyftOff is the flexible alternative to traditional contact center staffing. Talk to our team about your contact center."}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{
                      background: "#a855f7", color: "#fff", borderRadius: 8,
                      padding: "12px 24px", fontSize: 14, fontWeight: 700,
                      cursor: "pointer", textAlign: "center", whiteSpace: "nowrap",
                    }}>
                      Talk to ShyftOff →
                    </div>
                  </div>
                </div>
              </div>
              );
            })()}

          </div>
        </div>
      </div>
      )}
    </div>
  );
}
