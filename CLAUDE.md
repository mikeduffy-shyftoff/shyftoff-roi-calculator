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

## Conventions — aligned to the `shyftoff-brand` skill
- Dark theme (`#27133A` Deep Purple background)
- `#794EC2` Orion Violet = primary interactive / ShyftOff brand purple
- `#4D1F3B` Crimson Nova = traditional / deep accent surfaces
- `#FF66C4` Nebula Pink = "traditional / over-staffed" data viz
- `#FF7866` Cosmic Orange = savings / winner / CTA highlights
- `#FFE566` Solar Flare = SL warning / cautionary
- `#8F68D3` Starlight Purple = secondary mid-tones, accent lines
- `#C9C1D6` brand gray-muted = secondary text
- Font: Inter (single family — body and numbers both)
- Logo: real ShyftOff SVG inline (from `~/.claude/skills/shyftoff-brand/references/logo-inline.md`)
  - dark-bg variant: wordmark fill `#FFFFFF`, rocket gradient unchanged

## Responsive layout
Media queries in `src/index.css` collapse the calculator to a single column
below 768px. The Calculator component carries `className`s (`calc-layout`,
`calc-inputs`, `calc-header`, `calc-scenarios-grid`, `calc-metrics-row`,
`calc-content`, `calc-heatmap-strip`) that the CSS targets with `!important`
to override inline styles.

## Known issues (backlog)
_(none open — heatmap alignment, mobile breakpoint, and legacy-helper cleanup
all landed in the post-Phase-2 polish pass on 2026-05-20.)_
