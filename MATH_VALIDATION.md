# Math Validation — ShyftOff ROI Calculator

One-page reference for when an exec, CFO, or skeptical buyer asks **"where
did that number come from?"** Every formula in the demo is traceable to
either textbook contact-center math or a named citation. Code paths and
tests pinning each behavior are linked.

---

## 1. Headline savings number

**Claim:** "$29,456/mo (28.5%) savings, ShyftOff vs Traditional, at 20k
contacts/mo, 5-min AHT, 80/30 SL, $35 ShyftOff rate."

**Decomposition:**
```
Traditional monthly cost = scheduledHrs × loadedRate
                         + (sup + mgr + wfm headcount × salaries / 12)
                         + (peak agents × workstation cost / equipment life)

ShyftOff monthly cost    = requiredHrs × $35

Savings = Traditional − ShyftOff
```

Where `scheduledHrs` is the **shift-block** total (full 8-hr shifts solved
to cover the demand curve) and `requiredHrs` is the **interval-matched**
total (sum of per-interval staffing × interval length). The gap between
the two is shift-block geometry inefficiency — the heart of the pitch.

**Code:** `src/lib/scenarios.js:344-363` (`computeScenarioCost` returns
`gigCost` and `traditionalCost`).
**Test:** `smoke.test.js` "demo smoke: 20k contacts..." — pins savings
inside the 20–40% band.

---

## 2. Per-interval staffing (Erlang C)

**Claim:** "We staff to Erlang C, the industry-standard call-center
queueing model."

**Formula (Erlang C blocking probability):**
```
                    A^N / N!
C(N, A) = ─────────────────────────────────
          A^N/N! + (1−ρ) × Σ A^k/k! for k<N

ρ = A / N  (offered load / agents)
A = (calls/interval × AHT_sec) / interval_sec  (in Erlangs)
```

**Service Level (probability call answered within T seconds):**
```
SL(T) = 1 − C(N, A) × exp(−(N − A) × T / AHT_sec)
```

**Citation:** Erlang, A.K. (1909). *The Theory of Probabilities and
Telephone Conversations*. The foundational queueing formula. Used in
every WFM platform on the market (Verint, NICE, Calabrio, etc.).

**Code:** `src/lib/erlang.js` — `erlangC()`, `serviceLevel()`,
`findRequiredAgents()`.
**Test:** `smoke.test.js` lines 19-37 — textbook 5-agent / 3-Erlang case
pins `C ≈ 0.236`.

---

## 3. AI containment cascade

**Claim:** "60% containment doesn't mean 60% of calls disappear. Some bounce
back."

**Formula:**
```
contained    = volume × containmentRate
escalated    = contained × escalationRate           ← bounces back to humans
humanVolume  = volume − contained + escalated
             = volume × (1 − containment × (1 − escalation))

netDeflection = containment × (1 − escalation)
```

**Why it matters:** The naive "X% containment = X% savings" model overstates
deflection. At 60% containment / 18% escalation, the *net* is 49.2%, not
60% — and human staffing scales with humanVolume, not raw containment.

**Citation:** Gartner Customer Service Survey, October 2025 (n=321):
industry median containment ~50%, top quartile 70%+. 80% kept agent
headcount stable or increased it despite AI deflection.

**Code:** `src/lib/scenarios.js:76-78, 102` (cascade) + `:84-86`
(netContainment used for AHT residual mean).
**Test:** `smoke.test.js` "AI cascade: humanVolume and aiHandledCalls
obey containment × (1 − escalation)" — pins formula across 4 cases
including all 3 tier midpoints.

---

## 4. Residual AHT (post-AI handle-time inflation)

**Claim:** "Post-AI, what's left is harder. We model that with the
conditional mean of the call-duration distribution above the
containment cutoff."

**Formula:** Calls follow a log-normal distribution with mean μ and
coefficient of variation CV ≈ 0.6 (industry-typical voice spread). AI
deflects the *bottom* of the distribution (short, easy calls). The
expected handle time of what remains is:

```
humanAHT = E[AHT | AHT > q_p]
where q_p = the p-th percentile of LogNormal(μ, σ)
      p   = netContainment = containment × (1 − escalation)
```

For μ = 5 min, CV = 0.6, p = 0.60 → humanAHT ≈ 7.7 min (1.55× base).

**Citation:** Conditional expectation of a truncated log-normal is a
standard result. Log-normal AHT distribution is documented across BPO
literature; CV ≈ 0.5–0.7 is the typical voice band.

**Code:** `src/lib/distribution.js` — `lognormalConditionalMean()`.
**Test:** `smoke.test.js` "Post-AI scenario (S3) reduces human volume
and inflates AHT via log-normal distribution" — pins humanAHT and
ahtFactor for the demo defaults.

---

## 5. Peakedness-adjusted Erlang C (variability buffer)

**Claim:** "Post-AI, the residual stream is bumpier (higher CV).
Vanilla Erlang C under-staffs that. We add a buffer."

**Formula:**
```
cvUplift          = monthlyVolume / humanVolume − 1
volatilityBuffer  = 1 + α × cvUplift               ← α = 0.10 default

stafingVol = dailyVol × volatilityBuffer
```

Erlang C is run against the inflated `stafingVol` so the solver schedules
a real-world buffer for the residual stream's higher CV.

**Citation:** Approximation in the spirit of:
- Hayward, W.S. (1952). *The reliability of telephone traffic load
  measurements by switch counts*. Bell System Tech Journal.
- Schrieck, A., Akşin, O.Z., Chevalier, P. (2014). *Peakedness-based
  staffing rules for call centers with arrival rate uncertainty*.
  Production and Operations Management, 23(7).

NOTE: This is a simplified linear approximation, not a precise Hayward
implementation. α is a calibration knob.

**Code:** `src/lib/scenarios.js:93-94, 229`.
**Test:** `smoke.test.js` "volatility buffer inflates post-AI staffing
cost when α > 0" — pins buffer formula and the cost impact.

---

## 6. Coverage Target calibration (SL-calibrated)

**Claim:** "100% coverage delivers the SL target. 95% saves money but
misses SL."

**Mechanism:** Find geometry-buffer constant `K` such that the shift-block
solver delivers the target SL at coverage = 1.0 **when maxOcc is at its
natural value**. Binary search over K (12 iterations, range 0.5–2.5).

```
effectiveCoverage = K × influxTarget       ← influxTarget = user's slider × K

Above natural occ:  intervals require fewer agents → less staffing → SL drops
Below natural occ:  intervals require more agents → more staffing → SL exceeds target
At natural occ:     calibration delivers exactly the target SL
```

**Why anchor K to natural maxOcc:** If K recompiled when the user moves
the maxOcc slider, the slider would do nothing to SL. Anchoring K to
the demand curve + shift menu means moving maxOcc genuinely changes the
delivered SL number on screen.

**Code:** `src/lib/scenarios.js:130-220`.

---

## 7. Wage premium application

**Claim:** "Post-AI, Tier-2 wages run 20–30% higher than Tier-1. We
apply that to the traditional base wage only. ShyftOff rate is untouched."

**Formula:**
```
AI mode:
  effectiveRate = traditionalRate × (1 + premium/100)
  loadedRate    = effectiveRate × (1 + benefits/100)
                = trad × (1 + premium) × (1 + benefits)

Pre-AI mode:
  effectiveRate = traditionalRate
  loadedRate    = traditionalRate × (1 + benefits/100)

gigRate         = activeTier.rate                     ← unchanged regardless
```

**Citation:** ZipRecruiter 2026 — Tier-2 customer service vs Tier-1
median wage data shows a 20–30% spread.

**Code:** `src/lib/scenarios.js:105-108, 342-344`.
**Test:** `smoke.test.js` "wage premium: applies only to base trad wage
in AI mode; ShyftOff rate untouched; off in pre-AI".

---

## 8. Coverage Recovery (interval-coverage delta)

**Claim:** "ShyftOff covers N more intervals per week than the traditional
shift-block schedule."

**Formula:**
```
underStaffedIntervalsDay  = count i where scheduledPerInterval[i] < ceil(required[i] / (1 − shrink))
operatingDaysPerWeek      = count of DOW with non-zero share
underStaffedIntervalsWeek = underStaffedIntervalsDay × operatingDaysPerWeek
```

This is the Simple view's missed-call recovery proxy. No $/call leap of
faith — purely a quality-of-coverage metric.

**Code:** `src/Calculator.jsx:524-548, 592-595`.

---

## Tier defaults (demo-locked)

| Tier | Containment | Cost band | Best for |
|------|------------:|----------:|----------|
| Lean | 32.5% | $0.06–$0.10/min | FAQ deflection, scripted intents |
| Standard | 52.5% | $0.10–$0.18/min | Multi-turn NLU, account-aware routing |
| Human-like | 72.5% | $0.18–$0.35/min | Brand-sensitive, conversational, sales-adjacent |

**Code:** `src/lib/presets.js`.
**Test:** `smoke.test.js` "each tier carries the demo-locked containment
midpoint".

---

## Demo smoke test (Round 4)

| Input | Value |
|-------|------:|
| Monthly call volume | 20,000 |
| AHT | 5 min |
| Service Level | 80/30 |
| ShyftOff rate | $35/hr (flat loaded) |
| Shrinkage | 35% (21% in-center + 14% out-of-center) |
| Operating hours | 8am–6pm, 7 days/wk |

| Output | Expected | What it means |
|--------|---------:|--------------|
| Erlang traffic intensity | 7.7 | Theoretical floor — agents busy on average |
| ShyftOff FTE-equivalent | ~12.2 | Floor + SL buffer + shrinkage, interval-matched |
| Traditional FTE-equivalent | ~24.4 | All of the above + shift-block geometry bloat |
| Bloat ratio | ~2.0× | The demo's headline |
| Achieved SL | 84.7% | Hits target 80% with margin |
| Monthly savings | $29,456 (28.5%) | Mid-20s% expected |

**Test pin:** `smoke.test.js` "demo smoke: 20k contacts..."

---

## What this calculator does NOT model

Be ready to acknowledge gaps before someone catches you:
- **Erlang A (abandonment)** — we estimate abandonment from interval
  shortfall, but don't run the full Erlang A queue model.
- **Multi-skill routing** — single skill assumed. Real centers route
  by language, tier, product line.
- **Outbound dialing** — inbound-only model.
- **Seasonal volume swing** — DOW is captured, but month-over-month
  seasonality is not. Plug in an average month.
- **Attrition cost** — wage premium captures wage difference, not the
  recruiting/training cost of replacing burned-out Tier-1 agents.
