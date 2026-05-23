# 5-Minute Demo Script

For the Trevor / Tiana / Aaron review and any follow-on customer demos.
Practice this 2–3 times before you run it live. Beats are timed for a
five-minute walkthrough; expand any beat with the Detailed view if the
audience asks.

**Open with:** `https://mikeduffy-shyftoff.github.io/shyftoff-roi-calculator/`
(or local `npm run dev` if Wi-Fi is sketchy).

---

## Beat 1 — The headline (0:00–0:30)

> "This is the ShyftOff ROI Calculator. By default it opens in Simple
> mode — four inputs, one number. Right now we're looking at 50,000
> contacts a month at the camel arrival curve, and ShyftOff saves this
> operation **$X/month**, or **Y%**, against a traditional contact center."

**Point at:** The green hero number.

**Don't say:** "Containment is …", "Erlang C says …" — that's for later.
Lead with the dollar amount.

---

## Beat 2 — Coverage recovery (0:30–1:00)

> "Underneath that we've got the Coverage Recovery card. ShyftOff covers
> **N more 30-minute intervals per week** than a traditional shift-block
> schedule. That's not a marketing number — it's literally a count of
> intervals where the shift-block solver came in short of what Erlang C
> said it needed."

**Point at:** "ShyftOff covers N more intervals/week…"

**Why this works:** It's a quality-of-coverage claim with no dollar leap
of faith. If anyone asks "what's it worth in dollars?" — that's a CFO
follow-up. Don't anchor on a $/missed-call number you can't defend.

---

## Beat 3 — Flip to Detailed (1:00–2:00)

> "If you want to see the model, click Detailed."

**Click:** Detailed toggle in the header.

> "Left side is inputs. Right side is the staffing chart. The black dots
> are what Erlang C says you need; the bars are what a shift-block
> schedule actually delivers. See those red strips at the bottom of the
> heatmap? Every red interval is an under-staffed interval — exactly the
> ones the Coverage Recovery card was counting."

**Point at:** Heatmap strip under the staffing chart.

> "The orange overhead on top of the bars at midday — that's shift-block
> bloat. You can't cover a peak without over-covering the shoulders. We
> measure it; it's the cost ShyftOff structurally doesn't pay."

---

## Beat 4 — The hover tour (2:00–3:00)

Pick 3 tooltips to hover. Skip the others unless asked.

**Hover Optimal Occupancy:** "Max % of paid time agents are on calls.
Above 85% you trade SL for cost — burnout follows. The slider auto-
defaults to the highest occupancy that still meets your SL target."

**Hover Shrinkage:** "In-center is breaks, lunch, coaching. Out-of-center
is training, PTO, sick. Industry standard 30–35%. ShyftOff carries its
own utilization adjustment — that's where the structural cost gap comes
from."

**Hover ShyftOff Rate (the Interval Matching one):** "Traditional centers
staff full shifts, which over-cover slow intervals and under-cover peaks.
ShyftOff staffs interval-by-interval — agents log in for the windows you
actually need."

**Why these three:** Occupancy explains the slider, Shrinkage explains
the orange bloat, Interval Matching explains why ShyftOff costs less.
Together they cover 80% of the questions a contact-center exec will ask.

---

## Beat 5 — Add AI scenarios (3:00–4:00)

**Click:** "+ Add AI scenarios" in the header.

> "Now we're looking at four scenarios: pre-AI traditional, pre-AI
> ShyftOff, post-AI traditional, post-AI ShyftOff. The gap callout up
> top is the most important card on this whole calculator."

**Scroll to:** The Containment-to-Savings Gap card.

> "Buyers assume X% containment equals X% staffing cut. It doesn't.
> Erlang C is non-linear, residual calls are harder, and traditional-
> center overhead — shrinkage, shift bloat, supervisor ratios — doesn't
> scale down. The Gartner data here is October 2025, 321 customer-
> service leaders. **Only 20% cut agent headcount because of AI.
> Fifty-five percent kept staffing stable** on higher volumes."

**Point at:** Containment % vs Savings % on the gap card.

> "This is the slide CFOs want to see. Containment is the marketing
> number. Savings is the budget number. They are not the same number."

---

## Beat 6 — Tier picker + the close (4:00–5:00)

**Scroll to:** AI Cost Stack section. Click between Lean / Standard /
Human-like.

> "We've locked three tier midpoints to industry data — Lean is
> FAQ-grade, 32.5% containment; Standard is multi-turn NLU at 52.5%;
> Human-like is conversational at 72.5%. Watch what happens to the
> savings number when I switch tiers."

**Click through tiers, then land back on Standard.**

> "Even at 72.5% containment on the Human-like tier — the most optimistic
> case in market — the savings number doesn't double. Because, again,
> containment isn't a staffing cut. **The structural cost gap is in the
> labor model, not the AI tier.**"

**Pause. Then:**

> "Everything you see is on a public URL, model is documented in
> MATH_VALIDATION.md, and 31 tests pin the key numbers so they can't
> drift. We can sit a CFO down with this and walk every line."

---

## Common pushback — be ready

| If they say… | You say… |
|---|---|
| "Where's the 7-FTE number?" | "Erlang traffic intensity for this scenario — 20k × 5 min ÷ operating minutes = 7.7. That's the floor. Real staffing sits at ~12 for ShyftOff, ~24 for shift-block." |
| "What if containment is 90%?" | "Slider goes to 95%. Move it and watch. Even at 90%, you're not 90% off your wage bill — see the gap card." |
| "Where's abandonment?" | "We estimate it from interval shortfall — see the staffing chart. It's not a full Erlang A model; we'd build that for an in-flight deployment." |
| "Why $35/hr flat?" | "ShyftOff Standard. Loaded — benefits, supervision, platform all in. No tiered pricing, no volume discount surprise." |
| "Can I change the AHT?" | "Click Detailed. Top of the inputs panel. Same with shrinkage, SL target, occupancy, DOW distribution, arrival curve." |
| "Where did the Gartner data come from?" | "Gartner Customer Service Survey, October 2025, n=321. Footnote is under the AI Containment slider." |
| "What about attrition?" | "Wage premium captures wage; doesn't capture recruiting/training cost of churn. Flagged as a gap in MATH_VALIDATION.md." |

---

## Don't do this on stage

- **Don't open Detailed first.** Simple is the headline. If you open
  Detailed, you've already lost the executive — 40 inputs is wallpaper.
- **Don't read tooltip copy verbatim.** Paraphrase. The tooltips are
  there for the audience to hover later, not for you to recite.
- **Don't push the occupancy slider above 90% live.** It works — it
  shows the silent SL warning — but explaining the warning eats your
  closing minute. Set it once before the demo and leave it.
- **Don't compare to "industry savings benchmarks."** Anchor on the
  demo's own numbers. Gartner gets one citation; that's enough.

---

## After the demo

If the audience leans in, hand them:
- The live URL (above)
- `MATH_VALIDATION.md` — one-page math cheat sheet
- This script if they want to replay it themselves

If the audience checks out, end at Beat 6 and don't elaborate. The
calculator is a sales tool, not a workshop.
