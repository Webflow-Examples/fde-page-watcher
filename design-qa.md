# Watchlist monitoring-tolerances design QA

**Findings**

- [P1] Rendered implementation cannot be visually inspected yet.
  - Location: `/watchlist`, Monitoring tolerances section.
  - Evidence: the source visual is available at `/Users/mmunger/fde-page-watcher/design-qa-watchlist-stepper-after.png`, but the in-app browser tab was showing its connection-error state when the local preview restarted. The browser then blocked an automated refresh under its URL policy, so no current implementation screenshot can be captured or compared.
  - Impact: build, type, lint, and interaction-model tests pass, but the expanded grid, tooltip placement, responsive wrapping, and visual density have not passed the required browser-rendered comparison.
  - Fix: refresh the existing in-app Watchlist tab once, then capture and compare the rendered settings at the same 1243 × 1196 viewport.

**Source visual truth**

- Existing Watchlist settings capture: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-stepper-after.png`
- Source pixels: 1243 × 1196 at density 1.
- State: dark theme, default tolerance values, Desktop first.

**Rendered implementation**

- Local route: `http://localhost:3001/watchlist`
- HTTP response: 200.
- Expected viewport: 1243 × 1196 CSS px at density 1.
- Implementation screenshot: blocked pending a user refresh of the existing in-app browser tab.

**Required fidelity surfaces**

- Fonts and typography: blocked pending rendered evidence.
- Spacing and layout rhythm: blocked pending rendered evidence.
- Colors and visual tokens: implementation reuses existing tokens, but rendered comparison is still required.
- Image quality and asset fidelity: the information glyph uses the Phosphor icon library; no raster or generated assets were added.
- Copy and content: settings labels and tooltip copy are present in the server-rendered response; visual truncation and wrapping remain to be checked.

**Primary interactions tested**

- Threshold normalization, validation, persistence, scoring, device policy, metric cutoffs, agent-readiness cutoff, and grace-period behavior pass automated tests.
- Lint passes.
- 242 automated tests across 50 files pass.
- Production build and TypeScript pass.
- The local Watchlist route returns HTTP 200 and contains the new setting labels.
- Tooltip, reset-button, stepper, Save, responsive, and console checks are blocked pending the browser refresh.

**Comparison history**

1. The previous settings implementation passed visual QA at 1243 × 1196.
2. The expanded implementation preserves that design system in code, but no current browser-rendered comparison is available.

**Implementation checklist**

- Refresh the existing in-app Watchlist tab.
- Capture the full settings section and focused tooltip/control states.
- Compare against the source capture, fix any P0/P1/P2 differences, and repeat until passed.

**Follow-up polish**

- None assessed until rendered evidence is available.

final result: blocked
