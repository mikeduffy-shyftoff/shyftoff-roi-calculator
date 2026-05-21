# ShyftOff ROI Model — Cowork Brief

This brief is for running ad-hoc studies with the ShyftOff ROI math
outside the webapp. Pair it with `roi-lib.mjs` (the bundled pure math).

The model compares **traditional brick-and-mortar contact center costs**
vs **ShyftOff gig staffing**, with an optional AI scenario layer that
adds containment + escalation + AI infra cost.

---

## What the model computes

For each 30-min interval of the day:
- **Required agents** (Erlang C) given call volume, AHT, service level target
- **Scheduled agents** (greedy shift-block solver — replicates how real WFM
  schedules 8-hr shifts with staggered starts)
- **On-phone agents** (scheduled minus ramp/lunch/break/wind-down shrinkage)

Rolled up DOW-weighted to monthly cost:
- **Traditional cost** = scheduled-hours × loaded hourly rate + support
  (sup/mgr/wfm salaries) + workstation amortization
- **Gig cost** = productive-hours × tiered gig rate (no support, no
  workstation — ShyftOff includes those)
- **AI cost** (optional) = AI-handled minutes × per-minute AI stack cost

---

## The one function you need

```js
import * as ROI from "./roi-lib.mjs";

const result = ROI.computeScenarioCost({
  arrivalCurve: ROI.CAMEL,        // ROI.BELL | ROI.SINGLE_PEAK | ROI.CAMEL
  monthlyVolume: 50000,           // calls/month
  ahtMins: 8,                     // avg handle time
  startHour: 8,                   // open hour (0–23)
  endHour: 18,                    // close hour (>start, wraps midnight if <)
  dow: ROI.DEFAULT_DOW,           // % of weekly volume per day, 0 = closed
  gigTiers: ROI.DEFAULT_GIG_TIERS,// [{minHours, rate, label}], auto-selected by weekly hrs
  targetSL: 0.80,                 // service level target (fraction)
  targetSeconds: 20,              // answered-within seconds
  maxOcc: 0.85,                   // max occupancy
  shrinkage: 0.35,                // in-center shrinkage (fraction)
  shiftLength: 8,                 // traditional shift length (hrs)
  influxTarget: 1.20,             // schedule cushion factor

  // Traditional cost stack
  traditionalRate: 18,            // base hourly rate
  benefitsMultiplier: 0.35,       // benefits + tax as fraction of rate
  agentsPerSup: 15,
  agentsPerMgr: 40,               // pass Infinity to disable this tier
  agentsPerWfm: 150,              // pass Infinity to disable this tier
  supSalary: 60000,               // annual
  mgrSalary: 85000,
  wfmSalary: 75000,
  workstationCost: 1700,          // per seat
  equipmentLife: 60,              // months

  // AI layer — leave at zero/false for non-AI studies
  aiEnabled: false,
  containmentRate: 0,             // fraction of calls AI fully resolves
  escalationRate: 0,              // fraction of AI calls that escalate to human
  ahtFactor: 1,                   // post-AI calls take this × longer
  aiCostPerMin: 0,                // $/minute for the AI stack
  postAiWagePremium: 0,           // percent uplift on traditionalRate for post-AI human work
});
```

### What you get back (key fields)

| Field | Meaning |
|---|---|
| `traditionalCost` | Monthly traditional cost (shift labor + support + workstation) |
| `gigCost` | Monthly gig cost (productive hours × auto-tiered rate) |
| `traditionalTotal` | `traditionalCost + aiMonthlyCost` |
| `gigTotal` | `gigCost + aiMonthlyCost` |
| `peakTradAgents` | Max concurrent scheduled headcount across all DOWs |
| `avgFTE` | Average FTE-equivalent across the peak day |
| `supCount` / `mgrCount` / `wfmCount` | Support headcount derived from peakTradAgents |
| `supportCostMonthly` | Sup+Mgr+WFM annual salary total / 12 |
| `workstationCostMonthly` | `peakTradAgents × (workstationCost / equipmentLife)` |
| `monthlyRequiredHours` | Productive hours billed in the gig model |
| `monthlyScheduledHours` | Hours paid in the traditional model |
| `weeklyGigHours` | Drives gig tier selection |
| `gigRate` / `activeTierLabel` | The auto-selected gig $/hr and tier name |
| `aiMonthlyCost` / `aiHandledCalls` | Only nonzero when `aiEnabled: true` |
| `cv` | Coefficient of variation of call volume (volatility metric) |
| `intervals` | Peak day per-interval [{label, required, scheduled, calls, erlangs}] |
| `scheduledPerInterval` | Peak day scheduled headcount (for the bathtub chart) |
| `shiftAgents` / `shiftDefs` / `shiftMetrics` | Peak day shift-block solver output |

---

## Defaults to know

```js
ROI.DEFAULT_DOW
// { Mon: 16.5, Tue: 15.5, Wed: 15.0, Thu: 14.5, Fri: 14.0, Sat: 13.0, Sun: 11.5 }

ROI.DEFAULT_GIG_TIERS
// [{minHours: 0, rate: 31.00, ...}, {minHours: 750, rate: 30.50, ...}, {minHours: 1000, rate: 30.00, ...}]

ROI.TIER_PRESETS  // AI cost stacks
// { lean: {...}, standard: {...}, premium: {...} }
// each has { label, range, color, desc, vendors, costs: {aiSIP, aiSTT, aiLLM, aiTTS, aiOrchestration, aiCompliance, aiFailureBuffer} }

ROI.SINGLE_PEAK   // realistic single-peak intraday curve, 48 × 30-min
ROI.CAMEL         // dual-peak with lunch valley
ROI.BELL          // pure Gaussian centered at midday
```

---

## Ready-to-paste examples

### 1. Single scenario — what a 50K-call/mo center costs

```js
const r = ROI.computeScenarioCost({
  arrivalCurve: ROI.CAMEL,
  monthlyVolume: 50000, ahtMins: 8, startHour: 8, endHour: 18,
  dow: ROI.DEFAULT_DOW, gigTiers: ROI.DEFAULT_GIG_TIERS,
  targetSL: 0.80, targetSeconds: 20, maxOcc: 0.85, shrinkage: 0.35,
  shiftLength: 8, influxTarget: 1.20,
  traditionalRate: 18, benefitsMultiplier: 0.35,
  agentsPerSup: 15, agentsPerMgr: 40, agentsPerWfm: 150,
  supSalary: 60000, mgrSalary: 85000, wfmSalary: 75000,
  workstationCost: 1700, equipmentLife: 60,
  aiEnabled: false,
});
console.log(ROI.fmtCur(r.traditionalCost), "vs", ROI.fmtCur(r.gigCost));
// $424,562 vs $247,654
```

### 2. Industry archetype sweep

```js
const ARCHETYPES = [
  { name: "B2C retail support",      monthlyVolume:  30000, ahtMins:  6, curve: ROI.SINGLE_PEAK },
  { name: "Healthcare scheduling",   monthlyVolume:  80000, ahtMins:  9, curve: ROI.SINGLE_PEAK },
  { name: "B2B SaaS support",        monthlyVolume:  15000, ahtMins: 14, curve: ROI.CAMEL       },
  { name: "Insurance / financial",   monthlyVolume:  60000, ahtMins: 12, curve: ROI.CAMEL       },
  { name: "Travel / hospitality",    monthlyVolume: 100000, ahtMins:  7, curve: ROI.SINGLE_PEAK },
];

const baseArgs = {
  startHour: 8, endHour: 18,
  dow: ROI.DEFAULT_DOW, gigTiers: ROI.DEFAULT_GIG_TIERS,
  targetSL: 0.80, targetSeconds: 20, maxOcc: 0.85, shrinkage: 0.35,
  shiftLength: 8, influxTarget: 1.20,
  traditionalRate: 18, benefitsMultiplier: 0.35,
  agentsPerSup: 15, agentsPerMgr: 40, agentsPerWfm: 150,
  supSalary: 60000, mgrSalary: 85000, wfmSalary: 75000,
  workstationCost: 1700, equipmentLife: 60,
  aiEnabled: false,
};

const rows = ARCHETYPES.map(a => {
  const r = ROI.computeScenarioCost({ ...baseArgs, arrivalCurve: a.curve,
    monthlyVolume: a.monthlyVolume, ahtMins: a.ahtMins });
  return {
    archetype: a.name,
    trad: ROI.fmtCur(r.traditionalCost),
    gig:  ROI.fmtCur(r.gigCost),
    savings: ROI.fmtCur(r.traditionalCost - r.gigCost),
    savingsPct: ((1 - r.gigCost / r.traditionalCost) * 100).toFixed(1) + "%",
  };
});
console.table(rows);
```

### 3. Sensitivity sweep — savings vs containment rate

```js
const baseArgs = { /* same as above */ };
const stack = ROI.TIER_PRESETS.standard.costs;
const aiCostPerMin = (stack.aiSIP + stack.aiSTT + stack.aiLLM + stack.aiTTS +
                      stack.aiOrchestration + stack.aiCompliance) * (1 + stack.aiFailureBuffer / 100);

const sweep = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9].map(cr => {
  const trad = ROI.computeScenarioCost({ ...baseArgs, arrivalCurve: ROI.CAMEL,
    monthlyVolume: 50000, ahtMins: 8, aiEnabled: false });
  const post = ROI.computeScenarioCost({ ...baseArgs, arrivalCurve: ROI.CAMEL,
    monthlyVolume: 50000, ahtMins: 8,
    aiEnabled: true, containmentRate: cr, escalationRate: 0.20,
    ahtFactor: 1.30, aiCostPerMin, postAiWagePremium: 33 });
  return {
    containment: (cr * 100) + "%",
    "Trad+AI":     ROI.fmtCur(post.traditionalTotal),
    "ShyftOff+AI": ROI.fmtCur(post.gigTotal),
    "Savings vs Trad (no AI)": ROI.fmtCur(trad.traditionalCost - post.gigTotal),
  };
});
console.table(sweep);
```

### 4. Headcount / staffing detail for a single scenario

```js
const r = ROI.computeScenarioCost({ /* args */ });
console.log("Peak day intervals:");
console.table(r.intervals.map(iv => ({
  time: iv.label,
  required: iv.required,
  scheduled: iv.scheduled,
  calls: Math.round(iv.calls),
})));
console.log("Shifts:");
console.table(r.shiftAgents.map((agents, i) => ({
  shift: i + 1,
  startIdx: r.shiftDefs[i].startIdx,
  endIdx: r.shiftDefs[i].endIdx,
  agents,
  wasteHrsDay: r.shiftMetrics[i].wasteHrsDay.toFixed(1),
})));
```

### 5. Side-by-side scenario comparison helper

```js
function compare(scenarios) {
  return scenarios.map(({ label, args }) => {
    const r = ROI.computeScenarioCost(args);
    return {
      scenario: label,
      trad: ROI.fmtCur(r.traditionalCost),
      gig:  ROI.fmtCur(r.gigCost),
      aiAdd: ROI.fmtCur(r.aiMonthlyCost),
      winner: r.gigTotal < r.traditionalTotal ? "ShyftOff" : "Traditional",
      savingsPct: ((1 - r.gigTotal / r.traditionalTotal) * 100).toFixed(1) + "%",
    };
  });
}
```

---

## Quick reference: pure helpers

If you want to call the lower-level math directly (not the full scenario):

- `ROI.erlangC(agents, trafficErlangs)` — probability of wait
- `ROI.serviceLevel(agents, trafficErlangs, ahtSec, targetSec)` — SL fraction
- `ROI.findRequiredAgents(trafficErlangs, ahtSec, targetSL, targetSec, maxOcc)` — Erlang C agent count
- `ROI.computeIntervalStaffing({arrivalCurve, dailyVolume, ahtMins, startHour, endHour, ...})` — per-interval Erlang
- `ROI.solveShiftBlocks(intervals, shiftLengthHrs, shrinkage, influxTarget)` — greedy shift solver
- `ROI.computeOnPhones(shiftDefs, shiftAgents, n)` — actual on-phones after shrinkage curve

Formatters: `ROI.fmt`, `ROI.fmtD`, `ROI.fmtCur`, `ROI.fmtCurD`.

---

## How to keep the bundle in sync with the webapp

Anytime the math in `src/lib/` changes, regenerate the bundle:

```
npm run build:cowork
```

That regenerates `cowork/roi-lib.mjs`. Re-upload to Cowork to refresh.
