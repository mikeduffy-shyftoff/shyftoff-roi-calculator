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
      background: "#1F0E2F", border: "1px solid #4D1F3B", borderRadius: 12,
      padding: "20px 24px", ...style,
    }}>{children}</div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
      textTransform: "uppercase", color: "#794EC2", marginBottom: 12, marginTop: 4 }}>
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
          border: "1px solid #9B7FB5", color: "#C9C1D6", fontSize: 9, fontWeight: 700,
          cursor: "help", fontFamily: "'Inter', sans-serif", userSelect: "none",
          lineHeight: 1, paddingBottom: 1, background: "#27133A",
        }}
      >?</span>
      {open && (
        <div role="tooltip" style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: 0,
          width: 240, padding: "10px 12px",
          background: "#2E1740", border: "1px solid #794EC2", borderRadius: 8,
          fontSize: 11, lineHeight: 1.5, color: "#E8DFF6", fontWeight: 400,
          fontFamily: "'Inter', sans-serif", textAlign: "left",
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
        <label style={{ fontSize: 12, color: "#C9C1D6", fontWeight: 500, display: "inline-flex", alignItems: "center" }}>
          {label}
          {tooltip && <InfoTip text={tooltip} />}
        </label>
        {hint && <span style={{ fontSize: 10, color: "#9B7FB5" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min = 0, max, step = 1, prefix, suffix }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {prefix && <span style={{ fontSize: 12, color: "#C9C1D6" }}>{prefix}</span>}
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          flex: 1, background: "#2E1740", border: "1px solid #5D2F4B",
          borderRadius: 6, color: "#FFFFFF", padding: "7px 10px", fontSize: 13,
          fontFamily: "'Inter', sans-serif", outline: "none", width: "100%",
        }}
      />
      {suffix && <span style={{ fontSize: 12, color: "#C9C1D6", minWidth: 28 }}>{suffix}</span>}
    </div>
  );
}

function Slider({ value, onChange, min, max, step = 1, color = "#794EC2" }) {
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
        width: "100%", background: "#2E1740", border: "1px solid #5D2F4B",
        borderRadius: 6, color: "#FFFFFF", padding: "7px 10px", fontSize: 13,
        fontFamily: "'Inter', sans-serif", outline: "none",
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
      background: isWinner ? "linear-gradient(135deg, #3D2050 0%, #2E1740 100%)"
        : isDanger ? "linear-gradient(135deg, #3D1F1F 0%, #3D1F1F 100%)"
        : "#1F0E2F",
      border: `1px solid ${isWinner ? "#794EC2" : isDanger ? "#FF66C4" : "#4D1F3B"}`,
      borderRadius: 12, padding: "20px 20px 16px", position: "relative",
      boxShadow: isWinner ? "0 0 24px rgba(168,85,247,0.15)" : "none",
    }}>
      {tag && (
        <div style={{
          position: "absolute", top: -1, right: 12,
          background: isWinner ? "#794EC2" : "#FF66C4",
          color: "#fff", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", padding: "3px 8px", borderRadius: "0 0 6px 6px",
        }}>{tag}</div>
      )}
      <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'Inter', sans-serif", lineHeight: 1 }}>
        {fmtCur(cost)}
      </div>
      <div style={{ fontSize: 11, color: "#9B7FB5", marginTop: 2 }}>per month</div>
      {delta !== undefined && (
        <div style={{
          marginTop: 10, fontSize: 12, fontWeight: 600,
          color: delta < 0 ? "#FF7866" : delta > 0 ? "#FF66C4" : "#C9C1D6",
        }}>
          {delta < 0 ? "▼ " : delta > 0 ? "▲ " : ""}
          {delta < 0 ? `${fmtCur(Math.abs(delta))} saved` : delta > 0 ? `${fmtCur(delta)} more` : "baseline"}
          {deltaLabel && <span style={{ color: "#9B7FB5", fontWeight: 400 }}> {deltaLabel}</span>}
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
      fill="#C9C1D6" fontSize={10} fontFamily="Inter,sans-serif">
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
  // Light inputs (volume, AHT, hours, SL, agent rate) are always visible;
  // advanced (shrinkage, ratios, salaries, etc.) hides behind a + Show
  // advanced expander. Defaults closed so the first impression isn't a
  // wall of 20 fields.
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
    // Queue model: 'erlangC' (no abandonment, industry-classic, overstaffs
    // by 20–30% at peak per Brown 2005) or 'erlangA' (exponential patience,
    // modern WFM standard). Default A — more realistic, demo lands closer
    // to what production WFM tools (Verint/NICE) actually produce.
    queueModel: "erlangA",
    // Mean caller patience in seconds. Industry voice typical 60–120s; chat
    // tolerates much longer. Used only when queueModel === 'erlangA'.
    patienceSec: 90,
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
      queueModel, patienceSec, aht: ahtInputMin,
    } = inputs;
    // Erlang A impatience ratio: β = AHT / mean patience (both in seconds).
    // β = 0 when Erlang C is selected (no abandonment).
    const beta = queueModel === "erlangA" && patienceSec > 0
      ? (ahtInputMin * 60) / patienceSec
      : 0;

    const targetSL = serviceLevelTarget / 100;
    const maxOcc = maxOccupancy / 100;
    const shrink = (inCenterShrink + outOfCenterShrink) / 100;
    // Honor the user's actual in/out split (lib previously hardcoded 60/40).
    const inCenterRatio =
      (inCenterShrink + outOfCenterShrink) > 0
        ? inCenterShrink / (inCenterShrink + outOfCenterShrink)
        : 0.6;

    const aiCostBase = aiSIP + aiSTT + aiLLM + aiTTS + aiOrchestration + aiCompliance;
    const aiCostPerMin = aiCostBase * (1 + aiFailureBuffer / 100);

    // Build DOW object — each entry is % of weekly volume (0 = closed)
    const dow = { Mon: dowMon, Tue: dowTue, Wed: dowWed, Thu: dowThu,
                  Fri: dowFri, Sat: dowSat, Sun: dowSun };

    const shared = {
      arrivalCurve,
      startHour, endHour, dow, gigTiers, targetSL,
      targetSeconds: serviceLevelThreshold, maxOcc, shrinkage: shrink,
      inCenterShrinkRatio: inCenterRatio,
      queueModel, beta,
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
      { name: "Orchestration / Platform", value: aiOrchestration, color: "#794EC2" },
      { name: "Text-to-Speech (TTS)", value: aiTTS, color: "#8F68D3" },
      { name: "Speech-to-Text (STT)", value: aiSTT, color: "#8F68D3" },
      { name: "LLM Inference", value: aiLLM, color: "#794EC2" },
      { name: "SIP Trunking", value: aiSIP, color: "#8F68D3" },
      { name: "Compliance / PII", value: aiCompliance, color: "#794EC2" },
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
      minHeight: "100vh", background: "#27133A",
      fontFamily: "'Inter', system-ui, sans-serif", color: "#FFFFFF",
    }}>
      {/* Header */}
      <div className="calc-header" style={{
        borderBottom: "1px solid #4D1F3B", padding: "18px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#2E1740",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Official ShyftOff primary logo — inline SVG from the brand skill.
              Dark-background variant: wordmark fill swapped to #FFFFFF; the
              rocket icon's gradient is brand-locked and stays untouched. */}
          <svg
            width="148" height="36" viewBox="0 0 237 58"
            fill="none" xmlns="http://www.w3.org/2000/svg"
            aria-label="ShyftOff"
            style={{ flexShrink: 0 }}
          >
            <path d="M127.282 37.2129L132.318 22.7188H139.932L125.911 57.6475H118.337L123.616 45.4805L114.192 22.7188H121.884L127.282 37.2129ZM75.1146 15.9141C78.281 15.9141 80.7983 16.7055 82.6664 18.2881C84.5345 19.8707 85.5935 22.0486 85.8431 24.8213H78.3881C78.3013 23.9388 77.9406 23.1107 77.3617 22.4658C77.0641 22.1703 76.7124 21.941 76.3285 21.792C75.9447 21.643 75.5359 21.5773 75.1273 21.5986C74.4186 21.5648 73.7226 21.8055 73.1713 22.2754C72.9143 22.5286 72.7141 22.8388 72.5853 23.1836C72.4565 23.5285 72.4027 23.8999 72.4271 24.2695C72.4152 24.9393 72.6539 25.5874 73.0922 26.0732C73.5663 26.5887 74.1344 26.9984 74.7621 27.2783C75.4362 27.589 76.4009 27.9883 77.6654 28.4658C79.2 28.986 80.6955 29.6271 82.1381 30.3848C83.325 31.0525 84.3457 32.006 85.1166 33.167C85.9507 34.3818 86.3656 35.9646 86.3627 37.915C86.3755 39.4549 85.9787 40.9683 85.2172 42.2832L85.0599 42.5518C84.2522 43.8092 83.1386 44.8183 81.8334 45.4727C80.1421 46.3105 78.2868 46.7177 76.4183 46.6602C73.2197 46.6601 70.5867 45.8404 68.5189 44.2021C66.451 42.5638 65.3231 40.2764 65.1351 37.3398H72.4662C72.5226 38.3491 72.9327 39.3007 73.6166 40.0107C74.3006 40.6713 75.2045 41.0211 76.1322 40.9844C76.8975 41.0292 77.649 40.7558 78.225 40.2236C78.4828 39.9612 78.6846 39.6439 78.8168 39.293C78.9489 38.9421 79.0086 38.5655 78.9916 38.1885C79.0018 37.8367 78.9447 37.4863 78.8236 37.1582C78.7025 36.83 78.5198 36.5307 78.2865 36.2783C77.7811 35.7471 77.1829 35.3235 76.5248 35.0312C75.8242 34.7067 74.8586 34.3167 73.6205 33.8623C72.1126 33.3406 70.6407 32.7103 69.2152 31.9756C68.0382 31.3382 67.0275 30.4064 66.2719 29.2627C65.4524 28.0634 65.0424 26.5027 65.0424 24.5801C64.9985 22.9301 65.4503 21.3075 66.3334 19.9434C67.2271 18.61 68.4636 17.572 69.8978 16.9521C71.5505 16.2327 73.3265 15.8797 75.1146 15.9141ZM190.129 15.9268C192.679 15.9268 195.187 16.6048 197.421 17.8975L197.823 18.1523C199.808 19.4354 201.453 21.2319 202.598 23.374C203.846 25.8053 204.499 28.5249 204.499 31.2881C204.499 34.0515 203.846 36.7717 202.598 39.2031C201.373 41.4963 199.578 43.3948 197.404 44.6934C195.177 45.9853 192.676 46.6631 190.133 46.6631C187.591 46.6631 185.09 45.9852 182.864 44.6934C180.679 43.3976 178.873 41.4968 177.642 39.1982C176.387 36.7694 175.73 34.0487 175.73 31.2842C175.73 28.5194 176.387 25.7982 177.642 23.3691C178.872 21.0852 180.668 19.1941 182.837 17.8975C185.071 16.6049 187.58 15.9268 190.129 15.9268ZM153.703 13.2686C154.346 13.2686 154.831 13.2688 155.153 13.3105V19.542L154.404 19.5C153.28 19.5 152.456 19.7556 151.95 20.2656C151.443 20.7756 151.156 21.5914 151.103 22.7227H155.17V28.8242H151.09V46.375H144.217V28.8242H141.516V22.7227H144.217V22.4678C144.217 19.5281 145.023 17.261 146.654 15.666C148.284 14.0711 150.619 13.2686 153.703 13.2686ZM218.684 13.2686C219.331 13.2686 219.811 13.2689 220.137 13.3105V19.542L219.379 19.5C218.252 19.5001 217.432 19.7556 216.921 20.2656C216.41 20.7756 216.128 21.5914 216.076 22.7227H220.146V28.8242H216.076V46.375H209.198V28.8242H206.496V22.7227H209.198V22.4678C209.198 19.5281 210.01 17.261 211.634 15.666C213.259 14.071 215.609 13.2716 218.684 13.2686ZM234.574 13.2686C235.217 13.2686 235.701 13.2688 236.023 13.3105V19.542L235.279 19.5C234.151 19.5 233.331 19.7556 232.82 20.2656C232.309 20.7757 232.027 21.5915 231.974 22.7227H236.045V28.8242H231.974V46.375H225.087V28.8242H222.386V22.7227H225.087V22.4678C225.087 19.5282 225.9 17.261 227.524 15.666C229.148 14.071 231.498 13.2716 234.574 13.2686ZM97.0785 27.0596C97.7045 25.6684 98.7066 24.5026 99.9594 23.708C101.317 22.8645 102.873 22.4381 104.45 22.4785C107.028 22.4785 109.076 23.3832 110.591 25.1914L110.867 25.5244C112.199 27.2992 112.867 29.6702 112.87 32.6377V46.3721H105.983V33.4863C105.983 31.9039 105.586 30.6676 104.793 29.7773C104.387 29.3306 103.894 28.9803 103.348 28.75C102.803 28.5198 102.216 28.4142 101.629 28.4414C101.013 28.4093 100.398 28.5169 99.8246 28.7568C99.2515 28.9968 98.7337 29.3642 98.307 29.833C97.4878 30.7603 97.0785 32.0956 97.0785 33.8154V46.3623H90.1918V15.0049H97.0785V27.0596ZM168.009 22.7207H172.521V28.8271H168V37.6367C168 38.5639 168.181 39.213 168.542 39.584C168.904 39.9549 169.516 40.1357 170.375 40.1357L172.552 40.1309V46.3633H169.468C166.825 46.3633 164.777 45.678 163.326 44.3086C161.875 42.9392 161.14 40.6702 161.122 37.502V28.8271H158.1V22.7207H161.122V16.9102H168.009V22.7207ZM190.112 22.6826C187.859 22.6826 186.065 23.4555 184.732 25.001L184.49 25.2744C183.321 26.7879 182.737 28.7863 182.74 31.2695C182.743 33.9186 183.407 36.0116 184.732 37.5479C186.062 39.0934 187.856 39.8662 190.112 39.8662C192.367 39.8661 194.151 39.0932 195.464 37.5479C196.807 36.0023 197.478 33.9094 197.478 31.2695C197.478 28.6299 196.814 26.5403 195.487 25.001C194.156 23.4555 192.364 22.6827 190.112 22.6826Z" fill="#FFFFFF"/>
            <path d="M21.0342 44.8701C21.6001 44.8702 22.1428 45.1071 22.543 45.5283C22.9431 45.9495 23.1679 46.5206 23.168 47.1162C23.168 47.712 22.9432 48.2838 22.543 48.7051L14.6914 56.9648C14.4937 57.1735 14.2586 57.3392 14 57.4521C13.7415 57.565 13.4644 57.623 13.1846 57.623C12.9047 57.623 12.6277 57.565 12.3691 57.4521C12.1106 57.3392 11.8754 57.1735 11.6777 56.9648C11.2783 56.5433 11.0538 55.9723 11.0537 55.377C11.0537 54.7814 11.2782 54.2098 11.6777 53.7881L19.5244 45.5283C19.9246 45.107 20.4682 44.8701 21.0342 44.8701ZM17.4482 37.2637C17.7282 37.2635 18.0059 37.321 18.2646 37.4336C18.5234 37.5461 18.7589 37.7108 18.957 37.9189C19.1552 38.1272 19.3126 38.3753 19.4199 38.6475C19.5272 38.9196 19.5828 39.2113 19.583 39.5059C19.5832 39.8006 19.5279 40.0929 19.4209 40.3652C19.3139 40.6374 19.1567 40.8844 18.959 41.0928L6.96191 53.7188C6.76411 53.9272 6.52904 54.0931 6.27051 54.2061C6.01185 54.319 5.73416 54.3777 5.4541 54.3779C5.17405 54.3781 4.89651 54.3196 4.6377 54.207C4.37898 54.0944 4.14342 53.9299 3.94531 53.7217C3.74714 53.5134 3.58978 53.2654 3.48242 52.9932C3.3752 52.7211 3.32052 52.4293 3.32031 52.1348C3.32012 51.8403 3.3746 51.5486 3.48145 51.2764C3.58838 51.0041 3.74559 50.7563 3.94336 50.5479L15.9414 37.9219C16.1393 37.7133 16.3742 37.5476 16.6328 37.4346C16.8913 37.3217 17.1684 37.2639 17.4482 37.2637ZM53.9551 0C54.2833 -0.000610815 54.6088 0.0673181 54.9121 0.199219C55.2155 0.331123 55.4915 0.524305 55.7236 0.768555C55.9557 1.01274 56.1393 1.30293 56.2646 1.62207C56.39 1.94128 56.4547 2.28353 56.4541 2.62891C56.4803 8.31548 55.4336 13.9512 53.375 19.209C51.3163 24.4667 48.2862 29.2424 44.4609 33.2588L39.4814 37.8408L41.8613 37.0615C42.0229 37.0089 42.1951 37.0032 42.3594 37.0459C42.5237 37.0887 42.6742 37.1777 42.7939 37.3037C42.9136 37.4296 42.9984 37.5879 43.0391 37.7607C43.0797 37.9336 43.0744 38.1151 43.0244 38.2852L39.7949 49.5713L39.6758 50.0068C39.4068 50.9383 38.895 51.7725 38.1992 52.4141C37.5035 53.0555 36.6509 53.4795 35.7383 53.6377C34.8258 53.7958 33.8894 53.6821 33.0352 53.3096C32.1807 52.9368 31.442 52.3196 30.9033 51.5283L27.2812 46.1543L24.3203 41.7676C22.2229 38.8291 19.7515 36.2075 16.9756 33.9775L12.6533 30.7324L7.5332 26.9072C6.78075 26.3417 6.19393 25.5654 5.83887 24.667C5.48383 23.7686 5.37494 22.7835 5.52441 21.8232C5.6739 20.863 6.07565 19.9657 6.68457 19.2334C7.29348 18.5012 8.08518 17.963 8.96973 17.6797L9.38867 17.5635L20.1084 14.1514C20.2703 14.1016 20.4421 14.0984 20.6055 14.1426C20.7687 14.1867 20.9172 14.2767 21.0361 14.4023C21.1552 14.5281 21.2399 14.6853 21.2812 14.8574C21.3225 15.0294 21.3194 15.2098 21.2715 15.3799L20.5273 17.8789L24.8672 12.6396C28.6643 8.62513 33.1793 5.44082 38.1514 3.27148C43.1233 1.10227 48.4546 -0.00947152 53.8369 0H53.9551ZM9.98047 34.0361C10.5463 34.0363 11.0891 34.2732 11.4893 34.6943C11.8893 35.1156 12.1142 35.6866 12.1143 36.2822C12.1143 36.878 11.8895 37.4498 11.4893 37.8711L3.6416 46.1309C3.24205 46.552 2.70019 46.7895 2.13477 46.79C1.56929 46.7905 1.02618 46.5543 0.625977 46.1338C0.225837 45.7132 0.000515481 45.1421 0 44.5469C-0.000413147 43.9515 0.224398 43.3803 0.624023 42.959L8.4707 34.6943C8.87093 34.273 9.41446 34.0361 9.98047 34.0361ZM45.7949 8.34375C44.6926 7.8624 43.4655 7.79751 42.3232 8.16113C41.1811 8.52479 40.1942 9.29438 39.5303 10.3379C38.8664 11.3815 38.5669 12.6348 38.6826 13.8848C38.7983 15.1347 39.3222 16.3042 40.165 17.1934C41.1337 18.2129 42.4473 18.7865 43.8174 18.7881C45.0107 18.7881 46.1673 18.353 47.0898 17.5566C48.0124 16.7602 48.6437 15.6514 48.877 14.4199C49.1102 13.1882 48.9312 11.9087 48.3691 10.8008C47.8071 9.69307 46.8971 8.82507 45.7949 8.34375Z" fill="url(#paint0_radial_7449_19022)"/>
            <defs>
              <radialGradient id="paint0_radial_7449_19022" cx="0" cy="0" r="1" gradientTransform="matrix(-56.7785 48.9316 -48.729 -38.8907 50.3001 48.2113)" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FF66C4"/>
                <stop offset="0.423077" stopColor="#FF7866"/>
                <stop offset="1" stopColor="#C5AFE9"/>
              </radialGradient>
            </defs>
          </svg>
          <div style={{ borderLeft: "1px solid #4D1F3B", paddingLeft: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.01em" }}>
              ROI Calculator
            </div>
            <div style={{ fontSize: 12, color: "#FF7866", fontWeight: 500 }}>
              Insanely Easy Contact Center Ops
            </div>
          </div>
        </div>
        <div className="calc-header-controls" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={() => setShowAI(!showAI)}
            style={{
              background: showAI ? "#3D2050" : "#1F0E2F",
              border: `1px solid ${showAI ? "#794EC2" : "#5D2F4B"}`,
              color: showAI ? "#794EC2" : "#C9C1D6",
              borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Inter', sans-serif",
            }}
          >
            {showAI ? "✓ AI scenarios on" : "+ Add AI scenarios"}
          </button>
        </div>
      </div>

      <div className="calc-layout" style={{ display: "grid", gridTemplateColumns: "360px 1fr", minHeight: "calc(100vh - 65px)" }}>

        {/* ── Left: Inputs ───────────────────────────────────────────────────── */}
        <div className="calc-inputs" style={{
          borderRight: "1px solid #4D1F3B", padding: "24px 20px",
          overflowY: "auto", background: "#2E1740",
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
                <div style={{ fontSize: 10, color: "#9B7FB5", marginBottom: 4 }}>In-Center</div>
                <NumInput value={inputs.inCenterShrink} onChange={(v) => set("inCenterShrink", v)} min={0} max={50} suffix="%" />
                <div style={{ fontSize: 9, color: "#7A5A8E", marginTop: 3 }}>breaks · lunch · coaching</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#9B7FB5", marginBottom: 4 }}>Out-of-Center</div>
                <NumInput value={inputs.outOfCenterShrink} onChange={(v) => set("outOfCenterShrink", v)} min={0} max={50} suffix="%" />
                <div style={{ fontSize: 9, color: "#7A5A8E", marginTop: 3 }}>training · PTO · sick</div>
              </div>
            </div>
          </InputRow>
          <InputRow label="Intraday Arrival Pattern" hint={ARRIVAL_PRESETS[arrivalKey].hint}>
            <select
              value={arrivalKey}
              onChange={(e) => setArrivalKey(e.target.value)}
              style={{
                width: "100%", background: "#2E1740", border: "1px solid #5D2F4B", color: "#FFFFFF",
                borderRadius: 6, padding: "7px 10px", fontSize: 13,
                fontFamily: "'Inter', sans-serif", cursor: "pointer", outline: "none",
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
                  <div style={{ fontSize: 9, color: "#9B7FB5", marginBottom: 3, fontWeight: 600,
                    color: inputs[key] === 0 ? "#5D2F4B" : "#C9C1D6" }}>{label}</div>
                  <input type="number" value={inputs[key]} min={0} max={30} step={0.5}
                    onChange={(e) => set(key, parseFloat(e.target.value) || 0)}
                    style={{
                      width: "100%", background: inputs[key] === 0 ? "#27133A" : "#2E1740",
                      border: `1px solid ${inputs[key] === 0 ? "#1F0E2F" : "#5D2F4B"}`,
                      borderRadius: 5, color: inputs[key] === 0 ? "#5D2F4B" : "#FFFFFF",
                      padding: "5px 3px", fontSize: 11, textAlign: "center",
                      fontFamily: "'Inter', sans-serif", outline: "none",
                    }} />
                </div>
              ))}
            </div>
          </InputRow>
          </>)}

          <div style={{ borderTop: "1px solid #4D1F3B", margin: "16px 0" }} />
          <SectionLabel>Service Level</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InputRow label="SL Target" tooltip="Service Level: 'X% of calls answered in Y seconds.' Industry default is 80/20 — 80% answered within 20 seconds. Drives the Erlang C staffing requirement: tighter SL ⇒ more agents needed."  >
              <NumInput value={inputs.serviceLevelTarget} onChange={(v) => set("serviceLevelTarget", v)} min={50} max={99} suffix="%" />
            </InputRow>
            <InputRow label="Answer In">
              <NumInput value={inputs.serviceLevelThreshold} onChange={(v) => set("serviceLevelThreshold", v)} min={5} max={120} suffix="sec" />
            </InputRow>
          </div>

          {/* Queue model selector — Erlang A is the modern WFM standard
              (abandonment-aware); Erlang C is the classic infinite-patience
              model. Brown et al. (2005) showed Erlang C overstaffs by 20-30%
              at peak in real call centers. */}
          <InputRow label="Queue Model" tooltip="Erlang A models exponentially-distributed caller patience and is the modern WFM standard (Verint, NICE). Erlang C assumes infinite patience and overstaffs by 20–30% at peak per Brown et al. (2005), 'Statistical analysis of a telephone call center.' Both are supported — switch to see the difference.">
            <div style={{
              display: "inline-flex", background: "#1F0E2F", border: "1px solid #5D2F4B",
              borderRadius: 6, padding: 2, width: "100%",
            }}>
              {[
                { id: "erlangA", label: "Erlang A", hint: "with abandonment" },
                { id: "erlangC", label: "Erlang C", hint: "no abandonment" },
              ].map((m) => {
                const active = inputs.queueModel === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => set("queueModel", m.id)}
                    style={{
                      flex: 1, background: active ? "#3D2050" : "transparent",
                      border: active ? "1px solid #794EC2" : "1px solid transparent",
                      color: active ? "#794EC2" : "#C9C1D6",
                      borderRadius: 4, padding: "6px 8px", fontSize: 11, fontWeight: 600,
                      cursor: "pointer", fontFamily: "'Inter', sans-serif",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    }}
                  >
                    <span>{m.label}</span>
                    <span style={{ fontSize: 9, color: active ? "#C9C1D6" : "#7A5A8E", fontWeight: 400 }}>
                      {m.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </InputRow>

          {/* Mean patience — only when Erlang A is active. Default 90s reflects
              voice contact-center norms. Chat tolerates much longer. */}
          {inputs.queueModel === "erlangA" && (
            <InputRow label="Mean Caller Patience" hint="seconds before abandon · voice typical: 60–120s" tooltip="Average time a caller waits before hanging up. Modeled as exponential. Industry voice: 60–120s. Chat/async: 5–30 min. Lower patience ⇒ more abandonment ⇒ Erlang A predicts fewer agents needed to hit your SL target.">
              <NumInput value={inputs.patienceSec} onChange={(v) => set("patienceSec", v)} min={10} max={900} step={5} suffix="sec" />
            </InputRow>
          )}
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
                fontSize: 12, fontWeight: 700, color: "#794EC2",
                fontFamily: "Inter, sans-serif",
                transition: "left 80ms linear",
                pointerEvents: "none",
              }}>
                {inputs.maxOccupancy}%
              </span>
            </div>
            <Slider value={inputs.maxOccupancy} onChange={(v) => set("maxOccupancy", v)} min={1} max={99} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <span style={{ fontSize: 10, color: results.slWarning ? "#FFE566" : "#FF7866" }}>
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
                    background: "transparent", border: "1px solid #5D2F4B",
                    borderRadius: 4, color: "#C9C1D6", padding: "1px 6px",
                    fontSize: 10, cursor: "pointer", fontFamily: "Inter, sans-serif",
                  }}
                >↻ {results.naturalMaxOccPct}%</button>
              )}
            </div>
          </InputRow>
          )}

          <div style={{ borderTop: "1px solid #4D1F3B", margin: "16px 0" }} />
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
            background: "#27133A", border: "1px solid #4D1F3B", borderRadius: 8,
            padding: "12px 14px", marginBottom: 14,
          }}>
            <div style={{ fontSize: 10, color: "#C9C1D6", fontWeight: 600, marginBottom: 8,
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
            <div style={{ fontSize: 10, color: "#C9C1D6", fontWeight: 600, marginTop: 6, marginBottom: 6,
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
              background: "#3D2050", border: "1px solid #794EC2", borderRadius: 6,
              padding: "10px 12px", display: "flex", justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: 11, color: "#C9C1D6" }}>ShyftOff Standard</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#794EC2",
                fontFamily: "'Inter', sans-serif" }}>
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
              border: "1px dashed #5D2F4B", borderRadius: 6,
              color: "#C9C1D6", padding: "8px 10px", marginTop: 4,
              fontSize: 11, fontWeight: 600, cursor: "pointer",
              fontFamily: "'Inter', sans-serif",
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 6, transition: "all 120ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#794EC2"; e.currentTarget.style.borderColor = "#794EC2"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#C9C1D6"; e.currentTarget.style.borderColor = "#5D2F4B"; }}
          >
            <span>{showAdvanced ? "− Hide advanced" : "+ Show advanced"}</span>
            <span style={{ fontSize: 9, color: "#9B7FB5" }}>
              {showAdvanced
                ? "(collapses shrinkage, ratios, salaries, etc.)"
                : "(shrinkage, occupancy, ratios, salaries, workstation)"}
            </span>
          </button>

          {showAI && (<>
          <div style={{ borderTop: "1px solid #4D1F3B", margin: "16px 0" }} />
          <SectionLabel>AI Configuration</SectionLabel>
          <InputRow label="AI Containment Rate" hint="% of calls AI fully resolves" tooltip="% of contacts AI fully resolves without a human. Gartner Oct 2025 (n=321): industry median ~50%, top quartile 70%+. Tier midpoints — Lean 32.5% (FAQ deflection), Standard 52.5% (multi-turn NLU), Human-like 72.5% (conversational).">
            <Slider value={Math.round(inputs.containmentRate * 100)} onChange={(v) => set("containmentRate", v / 100)} min={25} max={95} color="#794EC2" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#9B7FB5" }}>25%</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#794EC2", fontFamily: "Inter, sans-serif" }}>
                {Math.round(inputs.containmentRate * 100)}%
              </span>
              <span style={{ fontSize: 10, color: "#9B7FB5" }}>95%</span>
            </div>
            <div style={{ fontSize: 10, color: "#C9C1D6", marginTop: 6, lineHeight: 1.4, fontStyle: "italic" }}>
              Gartner survey (Oct 2025, n=321 customer-service leaders): only{" "}
              <span style={{ color: "#FFE566", fontWeight: 600 }}>20%</span> cut agent headcount due to AI;{" "}
              <span style={{ color: "#FFE566", fontWeight: 600 }}>55%</span> kept staffing stable on higher volumes.
              Containment ≠ staffing cut — see the gap on the Scenarios tab.
            </div>
          </InputRow>
          <InputRow label="Escalation Rate" hint="% of AI calls that go to human" tooltip="% of AI-handled calls that escalate to a human anyway (failed containment, customer demand, edge cases). Industry band 15–25%. The cascade is: containment × (1 − escalation) = net volume kept off humans.">
            <Slider value={Math.round(inputs.escalationRate * 100)} onChange={(v) => set("escalationRate", v / 100)} min={5} max={50} color="#FFE566" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#9B7FB5" }}>5%</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#FFE566", fontFamily: "Inter, sans-serif" }}>
                {Math.round(inputs.escalationRate * 100)}%
              </span>
              <span style={{ fontSize: 10, color: "#9B7FB5" }}>50%</span>
            </div>
          </InputRow>
          {/* AHT Variability (CV) and the percentile table were removed in
              Round 1. CV is hardcoded to 0.6 (industry voice-call default) in
              the lib pass-through above. Add them back via the Detailed-mode
              toggle in Round 3 if users want to see / tune the distribution. */}
          <InputRow label="Post-AI Wage Premium (Trad)" hint="Tier-2 vs Tier-1 differential · industry: 20–30% (ZipRecruiter 2026)" tooltip="When AI absorbs Tier-1 (routine) work, the human stream is all Tier-2 (complex). Tier-2 agents cost more — ZipRecruiter 2026 shows 20–30% wage premium over Tier-1. Applies to the traditional base wage only; ShyftOff rate is untouched.">
            <Slider value={inputs.postAiWagePremium} onChange={(v) => set("postAiWagePremium", v)} min={0} max={80} color="#FFE566" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#9B7FB5" }}>0%</span>
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#FFE566", fontFamily: "Inter, sans-serif" }}>
                  +{inputs.postAiWagePremium}%
                </span>
                <span style={{ fontSize: 10, color: "#9B7FB5", marginLeft: 5 }}>
                  (${fmtD(inputs.traditionalRate * (1 + inputs.postAiWagePremium / 100), 2)}/hr)
                </span>
              </div>
              <span style={{ fontSize: 10, color: "#9B7FB5" }}>80%</span>
            </div>
          </InputRow>

          <div style={{ borderTop: "1px solid #4D1F3B", margin: "16px 0" }} />
          <SectionLabel>AI Cost Stack ($/min)</SectionLabel>

          {/* Tier preset selector */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14 }}>
            {Object.entries(TIER_PRESETS).map(([key, preset]) => {
              const active = selectedTier === key;
              return (
                <button key={key} onClick={() => applyPreset(key)} style={{
                  background: active ? "#3D2050" : "#2E1740",
                  border: `1px solid ${active ? preset.color : "#5D2F4B"}`,
                  borderRadius: 7, padding: "7px 6px", cursor: "pointer",
                  textAlign: "center", transition: "all 0.15s",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: active ? preset.color : "#9B7FB5", lineHeight: 1.2 }}>
                    {key === "lean" ? "Lean" : key === "standard" ? "Standard" : key === "humanlike" ? "Human-like" : key}
                  </div>
                  <div style={{ fontSize: 9, color: active ? "#C9C1D6" : "#7A5A8E", marginTop: 2 }}>{preset.range}/min</div>
                </button>
              );
            })}
          </div>
          {selectedTier !== "custom" && (
            <div style={{ fontSize: 10, color: "#C9C1D6", marginBottom: 12, lineHeight: 1.4 }}>
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
            background: "#3D2050", border: "1px solid #794EC2", borderRadius: 8,
            padding: "12px 14px", marginTop: 4,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "#C9C1D6" }}>Blended AI rate</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#794EC2", fontFamily: "Inter, sans-serif" }}>
                {fmtCurD(results.aiCostPerMin, 4)}/min
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "#C9C1D6" }}>Per {inputs.aht}-min call</span>
              <span style={{ fontSize: 12, color: "#794EC2", fontFamily: "Inter, sans-serif" }}>
                {fmtCurD(results.aiCostPerMin * inputs.aht, 3)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px solid #4D1F3B" }}>
              <span style={{ fontSize: 11, color: "#C9C1D6" }}>
                Hourly @ {inputs.maxOccupancy}% occ
                <span style={{ fontSize: 9, color: "#9B7FB5", display: "block", marginTop: 1 }}>
                  60 min × {inputs.maxOccupancy}% × {fmtCurD(results.aiCostPerMin, 4)}/min
                </span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#794EC2", fontFamily: "Inter, sans-serif" }}>
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
            borderBottom: "1px solid #4D1F3B", background: "#2E1740",
          }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "14px 18px", fontSize: 13, fontWeight: 600,
                color: activeTab === t.id ? "#794EC2" : "#C9C1D6",
                borderBottom: activeTab === t.id ? "2px solid #794EC2" : "2px solid transparent",
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
                    background: "linear-gradient(135deg, #3D1F1F 0%, #3D1F1F 100%)",
                    border: "1px solid #FF66C4", borderRadius: 10, padding: "14px 20px",
                    display: "flex", alignItems: "center", gap: 14,
                  }}>
                    <div style={{ fontSize: 24 }}>⚠️</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#FF66C4" }}>
                        AI + Traditional Staffing Costs MORE Than Doing Nothing
                      </div>
                      <div style={{ fontSize: 12, color: "#C9C1D6", marginTop: 2 }}>
                        AI agent costs add to a workforce you can't right-size — you pay for both.
                        Only flexible labor lets you fully capture AI savings.
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#FF66C4", fontFamily: "Inter, sans-serif" }}>
                        +{fmtCur(results.postTraditional - results.preTraditional)}
                      </div>
                      <div style={{ fontSize: 10, color: "#C9C1D6" }}>vs. status quo</div>
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
                        <div style={{ fontSize: 10, color: "#C9C1D6", fontStyle: "italic" }}>
                          peakedness-adjusted Erlang C (Hayward 1952 · Schrieck et al. POMS 2014)
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 14 }}>
                        Buyers assume <strong style={{ color: "#FFFFFF" }}>X% containment = X% staffing cut</strong>. It doesn't. Erlang C is non-linear, residual calls are harder, and traditional-center overhead (shrinkage, shift bloat, supervisor ratios) doesn't scale down.
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                        <div style={{ background: "#2E1740", border: "1px solid #5D2F4B", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#C9C1D6", marginBottom: 4 }}>AI Containment</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#794EC2", fontFamily: "Inter, sans-serif" }}>
                            {containmentPct}%
                          </div>
                          <div style={{ fontSize: 9, color: "#9B7FB5", marginTop: 4 }}>what AI handles</div>
                        </div>
                        <div style={{ background: "#2E1740", border: "1px solid #5D2F4B", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#C9C1D6", marginBottom: 4 }}>Traditional + AI cost change</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: tradReductionPct >= 0 ? "#FF7866" : "#FF66C4", fontFamily: "Inter, sans-serif" }}>
                            {tradReductionPct >= 0 ? "−" : "+"}{Math.abs(tradReductionPct).toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 9, color: "#9B7FB5", marginTop: 4 }}>
                            {tradReductionPct >= 0 ? "actual savings" : "cost went UP (trap)"}
                          </div>
                        </div>
                        <div style={{ background: "#2E1740", border: "1px solid #794EC2", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#794EC2", marginBottom: 4 }}>ShyftOff + AI cost change</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#FF7866", fontFamily: "Inter, sans-serif" }}>
                            −{gigReductionPct.toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 9, color: "#9B7FB5", marginTop: 4 }}>flex labor captures more</div>
                        </div>
                        <div style={{ background: "#2E1A0A", border: "1px solid #FFE566", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: "#FFE566", marginBottom: 4 }}>The Gap (Trad)</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#FFE566", fontFamily: "Inter, sans-serif" }}>
                            {gapPct.toFixed(0)} pts
                          </div>
                          <div style={{ fontSize: 9, color: "#9B7FB5", marginTop: 4 }}>containment % − savings %</div>
                        </div>
                      </div>

                      <div style={{ marginTop: 14, padding: "10px 12px", background: "#2E1740", borderRadius: 6, fontSize: 11, color: "#C9C1D6", lineHeight: 1.5 }}>
                        <strong style={{ color: "#FFFFFF" }}>Why the gap?</strong> AI handles routine calls; residual human calls are{" "}
                        <span style={{ color: "#8F68D3" }}>{fmtD((results.s3.ahtFactor - 1) * 100, 0)}% longer</span> (residual mean from log-normal distribution after AI cuts the easy tail) and{" "}
                        <span style={{ color: "#FFE566" }}>{fmtD(results.cvMultiplier, 1)}× more volatile</span> (same noise, smaller mean) — which drives a{" "}
                        <span style={{ color: "#FFE566" }}>+{fmtD((results.s3.volatilityBuffer - 1) * 100, 1)}% peakedness-adjusted staffing buffer</span> on top of base Erlang C.
                        Add a <span style={{ color: "#FFE566" }}>+{inputs.postAiWagePremium}% wage premium</span> (Tier-2 skill, ZipRecruiter 2026)
                        and traditional-center still carrying full shrinkage + supervisor ratios on a smaller pie.
                        <span style={{ color: "#C9C1D6", display: "block", marginTop: 6, fontSize: 10, lineHeight: 1.55 }}>
                          <strong style={{ color: "#C9C1D6" }}>Gartner (Oct 2025 survey, n=321 customer-service leaders):</strong>{" "}
                          only <span style={{ color: "#FFE566" }}>20%</span> cut agent headcount due to AI{" · "}
                          <span style={{ color: "#FFE566" }}>55%</span> maintained stable staffing despite higher volumes{" · "}
                          <span style={{ color: "#FFE566" }}>42%</span> are creating new AI-specific roles (strategists, conversational designers, automation analysts).{" "}
                          <em>Patrick Quinlan, Gartner Sr. Director Analyst: "Full automation will be prohibitively expensive for most organizations."</em>{" "}
                          Gartner forecasts <span style={{ color: "#FFE566" }}>half of orgs that cut staff will rehire by 2027</span> (Feb 2026 prediction).
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
                    color="#FF66C4"
                    delta={0}
                    deltaLabel="(baseline)"
                  />
                  <ScenarioCard
                    label="ShyftOff"
                    cost={results.preGig}
                    color={showAI ? "#FFE566" : "#FF7866"}
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
                        color="#FF66C4"
                        highlight="danger"
                        tag="Trap"
                        delta={results.postTraditional - results.preTraditional}
                        deltaLabel="vs baseline"
                      />
                      <ScenarioCard
                        label="ShyftOff + AI"
                        cost={results.postGig}
                        color="#FF7866"
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
                  <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
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
                      <CartesianGrid strokeDasharray="3 3" stroke="#4D1F3B" />
                      <XAxis dataKey="name" tick={{ fill: "#C9C1D6", fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#C9C1D6", fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtCur(v)} labelStyle={{ color: "#fff" }}
                        contentStyle={{ background: "#1F0E2F", border: "1px solid #5D2F4B" }} />
                      <Bar dataKey="cost" radius={[4, 4, 0, 0]}
                        label={<BarLabel formatter={(v) => `$${(v / 1000).toFixed(0)}k`} />}>
                        {(showAI ? [
                          { fill: "#FF66C4" }, { fill: "#FFE566" },
                          { fill: "#FF66C4" }, { fill: "#794EC2" },
                        ] : [
                          { fill: "#FF66C4" }, { fill: "#FF7866" },
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
                        <text dy={14} textAnchor="middle" fill="#C9C1D6" fontSize={11} fontWeight={600}>{payload.value}</text>
                        {d && <text dy={28} textAnchor="middle" fill="#9B7FB5" fontSize={10}>{d.sub}</text>}
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
                      <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 4, lineHeight: 1.6 }}>
                        Traditional centers pay for every scheduled hour — only a portion reaches a customer.
                        ShyftOff bills productive hours only. Same output, zero waste.
                      </div>
                      <div style={{ fontSize: 10, color: "#9B7FB5", marginBottom: 16, lineHeight: 1.6 }}>
                        <span style={{ color: "#794EC2" }}>In-center ({inputs.inCenterShrink}%)</span>: breaks, lunch rotations, coaching, system downtime — agent present, off-phones.&nbsp;
                        <span style={{ color: "#8F68D3" }}>Out-of-center ({inputs.outOfCenterShrink}%)</span>: training, vacation, sick/FMLA — agent absent.&nbsp;
                        Schedule inefficiency = shift-block over-coverage (agents available but not needed).
                        Adjust either input above to update.
                      </div>
                      <ResponsiveContainer width="100%" height={340}>
                        <BarChart data={hoursData} margin={{ top: 44, right: 130, left: 10, bottom: 50 }} barCategoryGap="35%">
                          <CartesianGrid strokeDasharray="3 3" stroke="#4D1F3B" vertical={false} />
                          <XAxis dataKey="name" tick={<CustomTick />} height={52} />
                          <YAxis
                            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                            tick={{ fill: "#C9C1D6", fontSize: 11 }}
                            label={{ value: "Hrs / Month", angle: -90, position: "insideLeft", fill: "#9B7FB5", fontSize: 11, dx: -5 }}
                          />
                          <Tooltip
                            formatter={(v, name) => v > 0 ? [`${Math.round(v).toLocaleString()} hrs`, name] : null}
                            labelStyle={{ color: "#fff" }}
                            contentStyle={{ background: "#1F0E2F", border: "1px solid #5D2F4B" }}
                          />
                          <Legend
                            verticalAlign="bottom" wrapperStyle={{ paddingTop: 12 }}
                            formatter={(value) => <span style={{ color: "#C9C1D6", fontSize: 11 }}>{value}</span>}
                          />
                          <ReferenceLine y={productive} stroke="#7A5A8E" strokeDasharray="5 3"
                            label={{ value: "← same productive output", position: "right", fill: "#9B7FB5", fontSize: 10 }} />

                          {/* 1 — Productive (bottom, both bars) */}
                          <Bar dataKey="Productive" stackId="a" name="Productive" fill="#27133A" radius={[0,0,4,4]}>
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
                                  <text x={x+width/2} y={y-18} textAnchor="middle" fill="#FF7866" fontSize={10} fontWeight={600}>(0% waste)</text>
                                  <text x={x+width/2} y={y-4} textAnchor="middle" fill="#FFFFFF" fontSize={12} fontWeight={700}>
                                    {productive.toLocaleString()} paid hrs
                                  </text>
                                </g>
                              );
                            }} />
                          </Bar>

                          {/* 2 — In-Center Shrinkage (breaks, lunch, coaching — agent present, off-phones) */}
                          <Bar dataKey="In-Center Shrinkage" stackId="a" name="In-Center Shrinkage" fill="#794EC2">
                            <LabelList dataKey="In-Center Shrinkage" content={segLabel} />
                          </Bar>

                          {/* 3 — Out-of-Center Shrinkage (training, vacation, sick — agent absent) */}
                          <Bar dataKey="Out-of-Center Shrinkage" stackId="a" name="Out-of-Center Shrinkage" fill="#8F68D3">
                            <LabelList dataKey="Out-of-Center Shrinkage" content={segLabel} />
                          </Bar>

                          {/* 4 — Schedule Inefficiency (shift-block overstaffing — agent available but not needed) */}
                          <Bar dataKey="Schedule Inefficiency" stackId="a" name="Schedule Inefficiency" fill="#8F68D3" radius={[4,4,0,0]}>
                            <LabelList dataKey="Schedule Inefficiency" content={segLabel} />
                            {/* Above-bar annotation for Traditional (Schedule Inefficiency is its topmost segment) */}
                            <LabelList position="top" content={({ x, y, width, index }) => {
                              if (index !== 0) return null;
                              const d = hoursData[0];
                              return (
                                <g>
                                  <text x={x+width/2} y={y-18} textAnchor="middle" fill="#FF66C4" fontSize={10} fontWeight={600}>
                                    ({d.wastePct}% waste)
                                  </text>
                                  <text x={x+width/2} y={y-4} textAnchor="middle" fill="#FFFFFF" fontSize={12} fontWeight={700}>
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
                      { s: "Trad (no AI)", v: fmtCurD(results.cprc.preTraditional, 2), c: "#FF66C4" },
                      { s: "ShyftOff (no AI)", v: fmtCurD(results.cprc.preGig, 2), c: "#FFE566" },
                      { s: "ShyftOff + AI", v: fmtCurD(results.cprc.postGig, 2), c: "#FF7866" },
                    ]},
                    { label: "AI Handled This Month", values: [
                      { s: "Calls resolved by AI", v: fmt(results.s3AIHandledCalls), c: "#794EC2" },
                      { s: "AI monthly cost", v: fmtCur(results.s3AIMonthlyCost), c: "#8F68D3" },
                      { s: "Cost per AI resolution", v: fmtCurD(results.s3AIMonthlyCost / (results.s3AIHandledCalls || 1), 3), c: "#8F68D3" },
                    ]},
                    { label: "Human Volume Post-AI", values: [
                      { s: "Residual human calls", v: fmt(results.humanVolumePostAI), c: "#8F68D3" },
                      { s: "Avg handle time", v: `${fmtD(results.humanAHTPostAI, 1)} min`, c: "#8F68D3" },
                      { s: "FTE required", v: fmtD(results.avgFTEPostTrad, 0), c: "#8F68D3" },
                    ]},
                  ] : [
                    { label: "Cost per Resolved Contact", values: [
                      { s: "Traditional", v: fmtCurD(results.cprc.preTraditional, 2), c: "#FF66C4" },
                      { s: "ShyftOff", v: fmtCurD(results.cprc.preGig, 2), c: "#FF7866" },
                      { s: "Savings per contact", v: fmtCurD(results.cprc.preTraditional - results.cprc.preGig, 2), c: "#794EC2" },
                    ]},
                    { label: "Traditional Cost Stack", values: [
                      { s: "Sup / Mgr / WFM", v: `${results.s1.supCount} / ${results.s1.mgrCount} / ${results.s1.wfmCount}`, c: "#FFE566" },
                      { s: "Support cost / mo", v: fmtCur(results.s1.supportCostMonthly), c: "#FFE566" },
                      { s: "Workstation / mo", v: fmtCur(results.s1.workstationCostMonthly), c: "#FFE566" },
                    ]},
                  ]).map(({ label, values }) => (
                    <Card key={label}>
                      <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 12, fontWeight: 600 }}>{label}</div>
                      {values.map(({ s, v, c }) => (
                        <div key={s} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "baseline" }}>
                          <span style={{ fontSize: 11, color: "#C9C1D6" }}>{s}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: c, fontFamily: "Inter, sans-serif" }}>{v}</span>
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
                      { label: "Pre-AI Demand Variability", value: `${fmtD(results.preCV * 100, 1)}%`, sub: "Coefficient of Variation", color: "#FFE566" },
                      { label: "Post-AI Demand Variability", value: `${fmtD(results.postCV * 100, 1)}%`, sub: "Coefficient of Variation", color: "#FF66C4" },
                      { label: "Volatility Multiplier", value: `${fmtD(results.cvMultiplier, 1)}×`, sub: "harder to staff with FTE", color: "#794EC2" },
                    ].map(({ label, value, sub, color }) => (
                      <Card key={label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 8 }}>{label}</div>
                        <div style={{ fontSize: 32, fontWeight: 800, color, fontFamily: "Inter, sans-serif" }}>{value}</div>
                        <div style={{ fontSize: 11, color: "#9B7FB5", marginTop: 4 }}>{sub}</div>
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
                  <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
                    Peak day. Post-AI demand is lower but more volatile — traditional shift blocks can't flex with it.
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={results.intervalChart} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <defs>
                        <linearGradient id="preGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FF66C4" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#FF66C4" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="postGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#794EC2" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#794EC2" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#4D1F3B" />
                      <XAxis dataKey="label" tick={{ fill: "#C9C1D6", fontSize: 10 }}
                        interval={3} />
                      <YAxis tick={{ fill: "#C9C1D6", fontSize: 11 }} label={{ value: "Agents", angle: -90, position: "insideLeft", fill: "#9B7FB5", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "#1F0E2F", border: "1px solid #5D2F4B" }}
                        labelStyle={{ color: "#fff" }} formatter={(v) => [fmt(v), ""]} />
                      <Legend wrapperStyle={{ fontSize: 12, color: "#C9C1D6" }} />
                      <Area type="monotone" dataKey="Pre-AI Demand" stroke="#FF66C4" strokeWidth={2}
                        fill="url(#preGrad)" dot={false} />
                      <Area type="monotone" dataKey="Post-AI Human Demand" stroke="#794EC2" strokeWidth={2}
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
                              color: "#C9C1D6", fontWeight: 600, borderBottom: "1px solid #4D1F3B",
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
                          <tr key={label} style={{ borderBottom: "1px solid #1F0E2F" }}>
                            <td style={{ padding: "9px 12px", color: bold ? "#fff" : "#C9C1D6", fontWeight: bold ? 700 : 400 }}>{label}</td>
                            {vals.map((v, i) => (
                              <td key={i} style={{
                                padding: "9px 12px", textAlign: "right",
                                color: bold
                                  ? (showAI
                                    ? (i === 2 ? "#FF66C4" : i === 3 ? "#FF7866" : "#FFFFFF")
                                    : (i === 0 ? "#FF66C4" : "#FF7866"))
                                  : "#C9C1D6",
                                fontWeight: bold ? 700 : 400,
                                fontFamily: "Inter, sans-serif",
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
                  <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
                    <span style={{ color: "#794EC2", fontWeight: 600 }}>Scheduled</span> = heads-in-seats from shift blocks &nbsp;|&nbsp;
                    <span style={{ color: "#FFE566", fontWeight: 600 }}>In Center</span> = bodies present (scheduled − out-of-center) &nbsp;|&nbsp;
                    <span style={{ color: "#FF66C4", fontWeight: 600 }}>Required</span> = raw Erlang C (on-phones demand) &nbsp;|&nbsp;
                    <span style={{ color: "#FF7866", fontWeight: 600 }}>On-Phones</span> = actually delivered after breaks/lunches
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={results.staffingChartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <defs>
                        <linearGradient id="schedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#794EC2" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#794EC2" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FF66C4" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#FF66C4" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#4D1F3B" />
                      <XAxis dataKey="label" tick={{ fill: "#C9C1D6", fontSize: 10 }} interval={3} />
                      <YAxis tick={{ fill: "#C9C1D6", fontSize: 11 }}
                        label={{ value: "Agents", angle: -90, position: "insideLeft", fill: "#9B7FB5", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "#1F0E2F", border: "1px solid #5D2F4B" }}
                        labelStyle={{ color: "#fff" }} formatter={(v, n) => [fmt(v), n]} />
                      <Legend wrapperStyle={{ fontSize: 12, color: "#C9C1D6" }} />
                      <Area type="stepAfter" dataKey="Scheduled (Shifts)" stroke="#794EC2" strokeWidth={2.5}
                        fill="url(#schedGrad)" dot={false} />
                      <Area type="stepAfter" dataKey="In Center" stroke="#FFE566" strokeWidth={2}
                        fill="none" dot={false} strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="Required (Erlang C)" stroke="#FF66C4" strokeWidth={2}
                        fill="url(#reqGrad)" dot={false} strokeDasharray="6 3" />
                      <Area type="monotone" dataKey="Actual On-Phones" stroke="#FF7866" strokeWidth={2}
                        fill="none" dot={false} strokeDasharray="4 4" />
                    </AreaChart>
                  </ResponsiveContainer>

                  {/* Over/under heatmap strip — one cell per 30-min interval.
                      paddingLeft/Right match Recharts' plot area so cells line
                      up with the chart's x-axis ticks above. */}
                  <div className="calc-heatmap-strip" style={{ marginTop: 6, paddingLeft: 55, paddingRight: 20 }}>
                    <div style={{ fontSize: 10, color: "#C9C1D6", fontWeight: 600, marginBottom: 4,
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
                              fontSize: 11, fontWeight: 700, color: "#27133A",
                              fontFamily: "'Inter', sans-serif",
                            }}>
                            {label}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4,
                      fontSize: 10, color: "#9B7FB5", fontFamily: "Inter, sans-serif" }}>
                      <span>{results.staffingChartData[0]?.label ?? ""}</span>
                      <span>{results.staffingChartData[Math.floor(results.staffingChartData.length / 2)]?.label ?? ""}</span>
                      <span>{results.staffingChartData[results.staffingChartData.length - 1]?.label ?? ""}</span>
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 10, color: "#C9C1D6" }}>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(239,68,68,0.7)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Understaffed</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(245,158,11,0.45)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />At target</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(34,197,94,0.6)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Overstaffed</span>
                    </div>
                  </div>
                </Card>

                {/* ── Shift Waste Warning ── */}
                <div style={{
                  background: "linear-gradient(135deg, #3D1F1F 0%, #3D1F1F 100%)",
                  border: "1px solid #FF66C4", borderRadius: 10, padding: "14px 20px",
                  display: "flex", alignItems: "center", gap: 16,
                }}>
                  <div style={{ fontSize: 22, flexShrink: 0 }}>⏳</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#FF66C4", marginBottom: 3 }}>
                      {showAI
                        ? "Even Smaller AI-Residual Volume Costs This Much — Volatility Forces Over-Coverage"
                        : "Paying for Every Scheduled Hour — Including Shrinkage and Coverage Gaps"}
                    </div>
                    <div style={{ fontSize: 12, color: "#C9C1D6", lineHeight: 1.5 }}>
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
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#FF66C4", fontFamily: "Inter, sans-serif" }}>
                      {fmtD(results.totalInefficiencyHrsDay, 0)} hrs/day
                    </div>
                    <div style={{ fontSize: 11, color: "#C9C1D6", marginTop: 2 }}>
                      {fmtCur(results.totalInefficiencyCostMonth)}/mo lost to inefficiency
                    </div>
                  </div>
                </div>

                {/* ── Shift Table ── */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Shift-Block Scheduling Inefficiency — Per Shift Breakdown
                  </div>
                  <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
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
                              padding: "8px 12px", color: "#C9C1D6", fontWeight: 600,
                              borderBottom: "1px solid #4D1F3B", fontSize: 11, whiteSpace: "nowrap",
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.shiftTableRows.map((row) => (
                          <tr key={row.name} style={{ borderBottom: "1px solid #1F0E2F" }}>
                            <td style={{ padding: "9px 12px", color: "#C9C1D6" }}>{row.name}</td>
                            <td style={{ padding: "9px 12px", color: "#C9C1D6", fontFamily: "Inter, sans-serif", fontSize: 11 }}>{row.window}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#794EC2", fontWeight: 700, fontFamily: "Inter, sans-serif" }}>{row.agents}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#C9C1D6", fontFamily: "Inter, sans-serif" }}>{row.avgNeeded}</td>
                            <td style={{ padding: "9px 12px", minWidth: 120 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                                <div style={{ width: 60, height: 6, background: "#4D1F3B", borderRadius: 3, overflow: "hidden" }}>
                                  <div style={{
                                    width: `${Math.min(row.utilizationPct, 100)}%`, height: "100%",
                                    background: row.utilizationPct >= 80 ? "#FF7866" : row.utilizationPct >= 60 ? "#FFE566" : "#FF66C4",
                                    borderRadius: 3,
                                  }} />
                                </div>
                                <span style={{ fontSize: 11, color: "#C9C1D6", fontFamily: "Inter, sans-serif", minWidth: 36, textAlign: "right" }}>
                                  {fmtD(row.utilizationPct, 0)}%
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#FFE566", fontFamily: "Inter, sans-serif" }}>
                              {fmtD(row.inefficiencyHrsDay, 1)}
                            </td>
                            <td style={{ padding: "9px 12px", textAlign: "right", color: "#FF66C4", fontFamily: "Inter, sans-serif" }}>
                              {fmtCur(row.inefficiencyCostMonth)}
                            </td>
                          </tr>
                        ))}
                        {/* Total row */}
                        <tr style={{ borderTop: "2px solid #5D2F4B", background: "#2E1740" }}>
                          <td colSpan={5} style={{ padding: "10px 12px", color: "#fff", fontWeight: 700, fontSize: 12 }}>
                            Total Shift Inefficiency
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#FFE566", fontWeight: 700, fontFamily: "Inter, sans-serif" }}>
                            {fmtD(results.totalInefficiencyHrsDay, 1)}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#FF66C4", fontWeight: 700, fontFamily: "Inter, sans-serif", fontSize: 14 }}>
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
                    <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
                      The amber dashed line is what buyers <em>assume</em> they'll get (linear cut). The gap to Trad + AI is real traditional-center overhead AI can't displace — shrinkage, shift bloat, supervisor ratios, residual SL floor.
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={results.sensitivityData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#4D1F3B" />
                        <XAxis dataKey="containment" tick={{ fill: "#C9C1D6", fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#C9C1D6", fontSize: 11 }} />
                        <Tooltip formatter={(v) => fmtCur(v)} contentStyle={{ background: "#1F0E2F", border: "1px solid #5D2F4B" }} />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#C9C1D6" }} />
                        <Line type="monotone" dataKey="Traditional + AI" stroke="#FF66C4" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="ShyftOff + AI" stroke="#794EC2" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="Trad (no AI)" stroke="#9B7FB5" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                        <Line type="monotone" dataKey="Naive Linear Estimate" stroke="#FFE566" strokeWidth={1.5} strokeDasharray="2 4" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                ) : (
                  <Card>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                      Sensitivity Analysis: Total Cost by Call Volume
                    </div>
                    <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
                      As volume grows, ShyftOff savings compound — Traditional loaded wages and support overhead create a steeper cost curve
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={results.volumeSweepData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#4D1F3B" />
                        <XAxis dataKey="label" tick={{ fill: "#C9C1D6", fontSize: 11 }} />
                        <YAxis
                          tickFormatter={(v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}k`}
                          tick={{ fill: "#C9C1D6", fontSize: 11 }} width={58}
                        />
                        <Tooltip
                          formatter={(v, name) => [fmtCur(v), name]}
                          labelFormatter={(l) => `${l} calls / mo`}
                          labelStyle={{ color: "#fff" }}
                          contentStyle={{ background: "#1F0E2F", border: "1px solid #5D2F4B" }}
                        />
                        <ReferenceLine
                          x={results.volumeSweepData[3]?.label}
                          stroke="#7A5A8E" strokeDasharray="4 4"
                          label={{ value: "current", fill: "#9B7FB5", fontSize: 10, position: "insideTopRight" }}
                        />
                        <Line type="monotone" dataKey="Traditional" stroke="#FF66C4" strokeWidth={2.5}
                          dot={{ r: 3, fill: "#FF66C4", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="ShyftOff" stroke="#794EC2" strokeWidth={2.5}
                          dot={{ r: 3, fill: "#794EC2", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                        <Legend formatter={(v) => <span style={{ color: "#C9C1D6", fontSize: 11 }}>{v}</span>} />
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
                  <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 20 }}>
                    Every component driving your AI agent cost per minute
                  </div>
                  {results.aiStack.map(({ name, value, color }) => {
                    const pct = results.aiCostBase > 0 ? value / results.aiCostBase : 0;
                    return (
                      <div key={name} style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 12, color: "#C9C1D6" }}>{name}</span>
                          <div style={{ display: "flex", gap: 16 }}>
                            <span style={{ fontSize: 12, color: "#9B7FB5" }}>{fmtD(pct * 100, 1)}%</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "Inter, sans-serif" }}>
                              {fmtCurD(value, 4)}/min
                            </span>
                          </div>
                        </div>
                        <div style={{ height: 8, background: "#4D1F3B", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{
                            width: `${Math.min(pct * 100, 100)}%`, height: "100%",
                            background: color, borderRadius: 4, transition: "width 0.4s ease",
                          }} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ borderTop: "1px solid #4D1F3B", marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "#C9C1D6" }}>Subtotal</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#794EC2", fontFamily: "Inter, sans-serif" }}>
                      {fmtCurD(results.aiCostBase, 4)}/min
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 12, color: "#C9C1D6" }}>+ {inputs.aiFailureBuffer}% failure buffer</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#794EC2", fontFamily: "Inter, sans-serif" }}>
                      {fmtCurD(results.aiCostPerMin, 4)}/min
                    </span>
                  </div>
                </Card>

                {/* Per-call costs */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card>
                    <div style={{ fontSize: 12, color: "#C9C1D6", marginBottom: 14, fontWeight: 600 }}>Per-Call AI Economics</div>
                    {[
                      { label: `AI cost / ${inputs.aht}-min call`, value: fmtCurD(results.aiCostPerMin * inputs.aht, 3), color: "#794EC2" },
                      { label: "AI cost / resolved contact", value: fmtCurD(results.s3AIMonthlyCost / (results.s3AIHandledCalls || 1), 3), color: "#8F68D3" },
                      { label: "Human cost / contact (trad)", value: fmtCurD(results.cprc.preTraditional, 2), color: "#FF66C4" },
                      { label: "Human cost / contact (gig)", value: fmtCurD(results.cprc.preGig, 2), color: "#FFE566" },
                      { label: "AI + gig blended / contact", value: fmtCurD(results.cprc.postGig, 2), color: "#FF7866" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: "#C9C1D6" }}>{label}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "Inter, sans-serif" }}>{value}</span>
                      </div>
                    ))}
                  </Card>
                  <Card>
                    <div style={{ fontSize: 12, color: "#C9C1D6", marginBottom: 14, fontWeight: 600 }}>Monthly AI Cost Roll-up</div>
                    {[
                      { label: "AI-handled calls", value: fmt(results.s3AIHandledCalls), color: "#794EC2" },
                      { label: "AI-handled minutes", value: fmt(results.s3AIHandledCalls * inputs.aht), color: "#8F68D3" },
                      { label: "Total AI cost/month", value: fmtCur(results.s3AIMonthlyCost), color: "#794EC2" },
                      { label: "As % of total cost (ShyftOff)", value: `${fmtD(results.s3AIMonthlyCost / (results.postGig || 1) * 100, 1)}%`, color: "#8F68D3" },
                      { label: "Containment rate", value: `${Math.round(inputs.containmentRate * 100)}%`, color: "#8F68D3" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                        <span style={{ fontSize: 11, color: "#C9C1D6" }}>{label}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "Inter, sans-serif" }}>{value}</span>
                      </div>
                    ))}
                  </Card>
                </div>

                {/* Benchmark comparison */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                    Market Rate Benchmarks
                  </div>
                  <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
                    Where your configured rate lands vs. industry pricing tiers
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {Object.entries(TIER_PRESETS).map(([key, preset]) => {
                      const active = selectedTier === key;
                      return (
                        <div key={key} onClick={() => applyPreset(key)} style={{
                          background: active ? "#3D2050" : "#2E1740",
                          border: `1px solid ${active ? preset.color : "#4D1F3B"}`,
                          borderRadius: 8, padding: "14px 14px", cursor: "pointer",
                          transition: "all 0.15s",
                          boxShadow: active ? `0 0 16px ${preset.color}22` : "none",
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: preset.color, marginBottom: 4 }}>
                            {preset.label}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", fontFamily: "Inter, sans-serif", marginBottom: 6 }}>
                            {preset.range}<span style={{ fontSize: 10, color: "#9B7FB5" }}>/min</span>
                          </div>
                          <div style={{ fontSize: 11, color: "#C9C1D6", lineHeight: 1.5 }}>{preset.desc}</div>
                          <div style={{ marginTop: 10, fontSize: 10, color: "#9B7FB5" }}>{preset.vendors}</div>
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
                            <div style={{ marginTop: 10, fontSize: 10, color: "#9B7FB5" }}>
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
                  background: "linear-gradient(135deg, #3D2050 0%, #1F0E2F 100%)",
                  border: "1px solid #794EC2", borderRadius: 14,
                  padding: "28px 32px", textAlign: "center",
                  boxShadow: "0 0 40px rgba(168,85,247,0.12)",
                }}>
                  <div style={{ fontSize: 12, color: "#C9C1D6", marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {showAI ? "Annual savings vs. Traditional (no AI)" : "Annual savings vs. Traditional"}
                  </div>
                  <div style={{ fontSize: 56, fontWeight: 900, color: "#FF7866", fontFamily: "Inter, sans-serif", lineHeight: 1 }}>
                    {fmtCur(heroSavings)}
                  </div>
                  <div style={{ fontSize: 16, color: "#794EC2", marginTop: 8, fontWeight: 600 }}>
                    {fmtD(heroPct * 100, 1)}% reduction in total contact center cost
                  </div>
                  <div style={{ fontSize: 12, color: "#9B7FB5", marginTop: 6 }}>
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
                  <div style={{ fontSize: 11, color: "#C9C1D6", marginBottom: 16 }}>
                    {showAI
                      ? "Monthly cost waterfall: baseline → gig savings → AI savings → total"
                      : "Monthly cost waterfall: traditional baseline → gig savings → total"}
                  </div>
                  {(() => {
                    const gigSavings = results.preTraditional - results.preGig;
                    const steps = showAI ? [
                      { label: "Traditional (no AI)", value: results.preTraditional, type: "base", color: "#FF66C4" },
                      { label: "ShyftOff flexibility savings", value: -gigSavings, type: "save", color: "#FF7866" },
                      { label: "AI containment savings", value: -(results.preGig - results.s4.gigCost), type: "save", color: "#794EC2" },
                      { label: "AI infrastructure cost", value: results.s3AIMonthlyCost, type: "cost", color: "#FFE566" },
                      { label: "ShyftOff + AI (total)", value: results.postGig, type: "total", color: "#FF7866" },
                    ] : [
                      { label: "Traditional", value: results.preTraditional, type: "base", color: "#FF66C4" },
                      { label: "ShyftOff flexibility savings", value: -gigSavings, type: "save", color: "#FF7866" },
                      { label: "ShyftOff (total)", value: results.preGig, type: "total", color: "#FF7866" },
                    ];
                    return steps.map(({ label, value, type, color }) => (
                      <div key={label} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 12, color: "#C9C1D6" }}>{label}</span>
                          <span style={{
                            fontSize: 13, fontWeight: 700, fontFamily: "Inter, sans-serif",
                            color: type === "save" ? "#FF7866" : type === "cost" ? "#FFE566" : color,
                          }}>
                            {type === "save" ? "−" : type === "cost" ? "+" : ""}{fmtCur(Math.abs(value))}
                          </span>
                        </div>
                        <div style={{ height: 10, background: "#4D1F3B", borderRadius: 5, overflow: "hidden" }}>
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
                        <span style={{ fontSize: 11, color: "#C9C1D6" }}>{k}</span>
                        <span style={{ fontSize: 11, color: "#FFFFFF", fontFamily: "Inter, sans-serif" }}>{v}</span>
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
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#794EC2", marginBottom: 2 }}>{point}</div>
                        <div style={{ fontSize: 11, color: "#C9C1D6", lineHeight: 1.5 }}>{desc}</div>
                      </div>
                    ))}
                  </Card>
                </div>

                {/* CTA */}
                <div style={{
                  background: "linear-gradient(135deg, #3D2050 0%, #2E1740 100%)",
                  border: "1px solid #794EC2", borderRadius: 12, padding: "24px 28px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 20,
                }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
                      Ready to capture {fmtCur(heroSavings)} in annual savings?
                    </div>
                    <div style={{ fontSize: 13, color: "#C9C1D6" }}>
                      {showAI
                        ? "ShyftOff provides the flexible gig workforce that makes AI economics work. Talk to our team about your deployment strategy."
                        : "ShyftOff is the flexible alternative to traditional contact center staffing. Talk to our team about your contact center."}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{
                      background: "#794EC2", color: "#fff", borderRadius: 8,
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
    </div>
  );
}
