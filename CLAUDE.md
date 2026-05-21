# ShyftOff ROI Calculator

## What
Sales tool comparing traditional contact center costs vs ShyftOff gig staffing,
with an optional AI scenario layer. Erlang C math, shift-block staffing solver,
tiered gig pricing, DOW-weighted monthly cost.

## Stack
React 19 + Recharts 3.8 + Vitest 4. Single Calculator component on top of a
pure math lib in `src/lib/`.

## Build / test / deploy
```
npm run dev          # Vite dev server (port 5173)
npm run build        # production static files → dist/
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npx netlify deploy --prod --dir=dist
```
Current site: dazzling-faloodeh-62ef97.netlify.app

## Layout
- `src/main.jsx` — renders `<Calculator />`.
- `src/Calculator.jsx` — single unified UI. Classic 2-scenario view (Trad vs
  Gig) is the default; the "+ Add AI scenarios" toggle expands to the
  4-scenario AI view (Pre/Post AI × Trad/Gig). Arrival pattern is selectable
  from a header dropdown (Bell / Single-Peak / Camel).
- `src/lib/` — pure modules, no React:
  - `erlang.js` — `logFactorial`, `erlangC`, `serviceLevel`,
    `findRequiredAgents`, `findRequiredAgentsLegacy` (the v15 search variant —
    kept for parity, not currently called).
  - `arrivalCurves.js` — `SINGLE_PEAK`, `CAMEL`, `BELL`, `DEFAULT_DOW`.
  - `staffing.js` — `solveShiftBlocks`, `computeOnPhones`,
    `computeIntervalStaffing`.
  - `scenarios.js` — `computeScenarioCost` (DOW-weighted, takes the full
    granular cost model: sup/mgr/wfm ratios + annual salaries, workstation
    cost, equipment life, influx target).
  - `format.js` — `fmt`, `fmtD`, `fmtCur`, `fmtCurD`.
  - `presets.js` — `TIER_PRESETS` (AI cost stacks), `DEFAULT_GIG_TIERS`.
- `src/lib/__tests__/smoke.test.js` — 22 tests pinning numerical output so
  refactors can't silently drift the math.

## Conventions
- Dark theme (`#0a0b0f` background)
- Purple (`#a855f7`) = ShyftOff brand
- Red (`#ef4444`) = traditional / waste
- Green (`#22c55e`) = savings / winner
- Amber (`#f59e0b`) = SL risk / cautionary
- Fonts: DM Sans (body), Space Mono (numbers)

## Responsive layout
Media queries in `src/index.css` collapse the calculator to a single column
below 768px. The Calculator component carries `className`s (`calc-layout`,
`calc-inputs`, `calc-header`, `calc-scenarios-grid`, `calc-metrics-row`,
`calc-content`, `calc-heatmap-strip`) that the CSS targets with `!important`
to override inline styles.

## Known issues (backlog)
_(none open — heatmap alignment, mobile breakpoint, and legacy-helper cleanup
all landed in the post-Phase-2 polish pass on 2026-05-20.)_
