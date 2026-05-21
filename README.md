# ShyftOff ROI Calculator

A web app that quantifies the cost gap between traditional contact-center
staffing and ShyftOff's gig labor model, with an optional AI-containment
scenario layer.

**Live:** https://mikeduffy-shyftoff.github.io/shyftoff-roi-calculator/

## What it models

- **Erlang C staffing** per 30-minute interval, occupancy- or SL-driven
- **Squared-deviation shift-block solver** with smart break placement
  (lunch/breaks concentrated in overlap valleys, matching how NICE IEX
  and Verint route intraday breaks)
- **Log-normal AHT distribution** — when AI containment removes the easy
  short calls from the bottom of the distribution, residual mean AHT
  auto-shifts up via the conditional-mean formula
- **Peakedness-style variability buffer** (Hayward 1952, Schrieck et al.
  POMS 2014) — residual post-AI demand has higher CV; the model inflates
  the Erlang C input proportionally
- **DOW-weighted monthly cost** with industry-realistic Monday-spike
  distribution (FlyFone, Bright Pattern, Peopleware data)
- **Calibrated coverage target** — `1.00` means "schedule enough to hit
  target SL given shift-block geometry inefficiency"; <1 = save cost,
  miss SL; >1 = over-provision

## Stack

React 19 + Recharts 3.8 + Vitest 4. Single calculator component on top
of a pure math library in `src/lib/`.

## Local development

```bash
npm install
npm run dev          # Vite dev server (port 5173)
npm test             # 27 smoke tests pinning numerical output
npm run build        # production static files → dist/
npm run build:cowork # regenerate the Cowork plugin bundle in cowork/
```

## Layout

- `src/main.jsx` — renders `<Calculator />`
- `src/Calculator.jsx` — single unified UI. Classic 2-scenario view (Trad
  vs Gig) is the default; the "+ Add AI scenarios" toggle expands to the
  4-scenario view
- `src/lib/` — pure math modules:
  - `erlang.js` — Erlang C, service level, occupancy-driven staffing
  - `distribution.js` — log-normal AHT model + conditional-mean truncation
  - `arrivalCurves.js` — Bell / Single-Peak / Camel arrival patterns,
    industry-realistic DOW distribution
  - `staffing.js` — shift-block solver, smart break placement
  - `scenarios.js` — DOW-weighted monthly cost calc, four scenarios
    (pre/post-AI × trad/gig), SL-calibrated coverage
  - `presets.js` — AI cost-stack presets (lean / standard / premium)
  - `format.js` — currency / number formatters
- `src/lib/__tests__/smoke.test.js` — pins numerical output to lock in
  the math against silent refactor drift

## Deployment

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every
push to `main`.

## License

Internal ShyftOff sales tool. © ShyftOff.
