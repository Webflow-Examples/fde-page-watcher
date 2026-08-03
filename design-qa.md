# Design QA

## Dashboard · combined cross-device verdict

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P1] The dashboard verdict and status counts were derived from the selected chart device, so switching Desktop/Mobile changed both the message and the page’s vertical position.
  - Location: dashboard verdict, status filters, and filter summary.
  - Evidence: Desktop showed `Nothing regressed today. 6 have agent-readiness gaps.` in a 42.2px headline with the table at `y=234.2px`; Mobile added four slow pages, wrapped to 82.4px, and moved the table to `y=274.4px`.
  - Impact: a chart-view preference changed the page-level health verdict and created a 40.2px layout shift.
  - Fix: compute low performance, regressions, and improvements across both Desktop and Mobile for every actively monitored page, then use those combined signals for the verdict, status counts, and status filters. The device control now changes only the score/chart view and explicit column sorting.
  - Post-fix evidence: Desktop and Mobile both show `4 pages are slow on at least one device`; headline height is 84.39px and the table begins at `y=276.39px` in both states.
- [Resolved P2] A combined headline count would have disagreed with the clickable status filter if filtering remained device-specific.
  - Fix: made the related status pills and filtered-row set use the same unique-page, either-device condition.
  - Post-fix evidence: Low performance shows four pages in both device states; the filtered table contains four rows and its summary consistently says `low performance on at least one device`.

### Source visual truth

- Browser annotation: comment 1 on `http://localhost:3001/dashboard`.
- Desktop starting state: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-combined-verdict-before-desktop.jpg`
- Mobile starting state: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-combined-verdict-before-mobile.jpg`
- State: dark dashboard, Last 7 days, no regressions, six agent-readiness gaps, and four pages below the Performance threshold on at least one device.

### Rendered implementation

- Local route: `http://localhost:3001/dashboard`
- Final Desktop screenshot: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-combined-verdict-after-desktop.jpg`
- Final Mobile screenshot: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-combined-verdict-after-mobile.jpg`
- Four-state focused comparison: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-combined-verdict-comparison.jpg`
- Screenshot pixels: 1269 × 714 from a 1280 × 720 CSS viewport at device pixel ratio 2; browser output is normalized to CSS pixels.

### Fidelity surfaces

- Fonts and typography: passed. Existing verdict font family, size, weight, line height, and linked-count treatment are unchanged.
- Spacing and layout rhythm: passed. The combined copy has identical height and table position for both device selections, eliminating the annotated toggle shift.
- Colors and visual tokens: passed. Good-state green, neutral copy, underlined counts, status dots, and selected-device tokens remain unchanged.
- Image quality and asset fidelity: passed. No imagery or icon assets changed.
- Copy and content: passed. `At least one device` communicates a deduplicated page-level condition without implying the currently selected chart device owns the verdict.

### Interaction and data checks

- Desktop → Mobile → Desktop produced identical verdict text, headline height, status counts, and table top.
- Low performance filtering returned the same four rows before and after switching devices.
- The filter summary stayed aligned with the combined condition.
- Agent-readiness remains page-level and unchanged.
- Score values, sparklines, secondary-device values, and manual column sorting still follow the selected device.
- Browser diagnostics reported no warnings or errors.

### Comparison history

- The initial comparison documented the 40.2px device-toggle layout shift and device-dependent verdict.
- Combined page signals were introduced and wired through both the verdict and its corresponding status filters.
- The final four-state comparison shows no remaining P0, P1, or P2 differences between Desktop and Mobile verdict geometry.

### Verification

- `npm run lint`: passed
- `npm test -- --run`: 58 files, 273 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Detail pages · compact heading scale correction

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P1] The reference layout was implemented with the reference image’s enlarged presentation scale, making every heading element materially larger than the existing product typography.
  - Location: the top of every `/pages/[id]` detail route.
  - Evidence: the oversized implementation rendered the breadcrumb at 20px, title at 52px, URL at 25px, and status row at 22px.
  - Impact: the heading dominated the viewport and changed the product’s established density even though the requested change was structural.
  - Fix: retained the new breadcrumb/title-link/status-row arrangement while restoring the original detail-page type tokens: 12.5px breadcrumb, 25px title, 13px URL, 12px device statuses, and 11.5px PSI copy.
  - Post-fix evidence: the heading’s content block reduced from 156.12px to 85.5px without changing element order, semantics, colors, links, controls, or page content.

### Source visual truth

- Layout source: `/Users/mmunger/Library/Application Support/CleanShot/media/media_pr3wAVnH4s/CleanShot 2026-07-24 at 18.47.38@2x.png`
- Typography source: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-redesign-before.jpg`, the pre-redesign detail page with the established 12.5px/25px/13px/11.5px scale.
- User correction: preserve the implemented layout but restore the previous text sizes.
- State note: the typography source shows Homepage while this verification uses Pricing; both routes consume the same detail-header component, and only the scale/layout system is compared.

### Rendered implementation

- Local route: `http://localhost:3001/pages/pricing`
- Oversized starting screenshot: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-scale-before.jpg`
- Corrected implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-scale-after.jpg`
- Screenshot pixels: 1269 × 714 from a 1280 × 720 CSS viewport at device pixel ratio 2; the browser capture is normalized to CSS pixels.
- Full-page before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-scale-comparison.jpg`
- Focused header comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-scale-focused-comparison.jpg`
- State: dark theme, Pricing, Desktop stable, Mobile stable, and no successful PSI run.

### Fidelity surfaces

- Fonts and typography: passed. WF Visual Sans remains unchanged, and every header text role is restored to its pre-redesign size and weight.
- Spacing and layout rhythm: passed. Breadcrumb, title/link, and device/run rows retain the selected arrangement with compact 8–14px gaps and no clipped or overlapping content.
- Colors and visual tokens: passed. The prior muted text, white emphasis, separator, and saturated blue status tokens remain intact.
- Image quality and asset fidelity: passed. No raster assets changed; the external-link affordance continues to use the installed Phosphor icon.
- Copy and content: passed. Dynamic page title, watched URL, device states, and PSI copy remain unchanged.

### Interaction and accessibility checks

- The Pricing URL remains a valid external link targeting a new tab.
- Both device statuses retain their accessible `Performance change: Stable` names.
- The current breadcrumb item remains marked with `aria-current="page"`.
- The page reports no horizontal overflow at the verified viewport.
- Browser diagnostics reported no warnings or errors.

### Comparison history

- The user’s correction identified one P1 scale mismatch in the first layout implementation.
- The layout was preserved and only type, icon, gap, divider, and vertical-spacing dimensions were restored to the product’s previous scale.
- The final full-page and focused comparisons show no remaining P0, P1, or P2 issues.

### Verification

- `npm run lint`: passed
- `npm test -- --run`: 57 files, 269 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Detail pages · reference-matched heading

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] The existing detail heading used a compact 25px title beside two stacked status cards, which did not match the reference’s editorial hierarchy.
  - Location: the top of every `/pages/[id]` detail route.
  - Evidence: the starting capture placed the Desktop and Mobile cards before the title and split the URL and PSI state across two small lines.
  - Fix: rebuilt the heading as a `Pages / {page}` breadcrumb, a 52px page title with a 25px external URL, and one 22px inline status line.
  - Post-fix evidence: the implemented heading is 202.12px tall versus the normalized reference’s 201px; the breadcrumb, title, link, device states, dividers, and PSI copy align to the same three-row composition.
- [Resolved P2] The detail-page link and status information did not carry the reference’s visual and semantic affordances.
  - Location: title row and inline device statuses.
  - Fix: added the installed Phosphor arrow-up-right icon, converted the full URL treatment into one external link, used the reference’s saturated blue status dots, and retained device-specific accessible status names.
  - Post-fix evidence: the page link resolves to `https://webflow.com`, opens in a new tab, and both device states expose `Performance change: Stable` labels.

### Source visual truth

- Selected reference: `/Users/mmunger/Library/Application Support/CleanShot/media/media_pr3wAVnH4s/CleanShot 2026-07-24 at 18.47.38@2x.png`
- Original source pixels: 1846 × 402 at 2× density.
- Normalized CSS-size reference: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-reference-normalized.png` at 923 × 201px.
- State: dark theme, Homepage, Desktop stable, Mobile stable, and no successful PSI run.

### Rendered implementation

- Local route: `http://localhost:3001/pages/home`
- Starting implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-redesign-before.jpg`
- Final implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-redesign-after.jpg`
- Browser screenshot pixels: 1269 × 714 from a 1280 × 720 CSS viewport at device pixel ratio 2; the browser capture is normalized to CSS pixels.
- Matched implementation crop: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-implementation-crop.png` at 923 × 201px.
- Source-to-implementation comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-source-comparison.png`
- Full-page before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-heading-redesign-page-comparison.jpg`

### Fidelity surfaces

- Fonts and typography: passed. The implementation uses the existing WF Visual Sans variable font with the reference-matched 20px breadcrumb, 52px display title, 25px URL, and 22px status line.
- Spacing and layout rhythm: passed. The normalized crop preserves the reference’s 31px left inset, three-row vertical cadence, and 201–202px overall heading height.
- Colors and visual tokens: passed. Background, primary text, muted breadcrumb/URL/PSI tones, dark separators, and saturated blue stable dots match the source palette.
- Image quality and asset fidelity: passed. The reference contains no raster imagery; its only icon is implemented with the installed Phosphor arrow-up-right icon rather than a custom drawing.
- Copy and content: passed. The breadcrumb, page name, watched URL, device names, lower-case status values, and PSI state mirror the source while remaining dynamic for every detail page.

### Interaction and accessibility checks

- The `Pages` breadcrumb navigated to `/dashboard` and the detail route was restored afterward.
- The watched-page link has the expected HTTPS destination, `target="_blank"`, and `rel="noreferrer"`.
- Desktop and Mobile status groups retain page-specific accessible names.
- The current breadcrumb item uses `aria-current="page"`.
- The page reported no horizontal overflow at the verified viewport.
- Browser diagnostics contained only React development and HMR informational messages; no warnings or errors were reported.

### Comparison history

- The first comparison identified one blocking visual mismatch: the card-based compact header did not share the selected reference’s hierarchy or layout.
- The header was rebuilt, then measured and captured at the same content state.
- The normalized source/implementation comparison shows no remaining P0, P1, or P2 differences; the controls, tabs, overview cards, and downstream content remain unchanged.

### Verification

- `npm run lint`: passed
- `npm test -- --run`: 57 files, 269 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Watchlist · drag-and-drop page ordering

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] Reordering a page required repeated clicks on a compact up/down stepper.
  - Location: the first column of every Watchlist page row.
  - Evidence: the starting capture showed two stacked arrow buttons in each 22 × 32px ordering slot.
  - Fix: replaced the stepper with one installed Phosphor drag-handle icon and direct row drag-and-drop behavior.
  - Post-fix evidence: all eight rows expose one 22 × 32px grab handle while preserving the original 69.18px row height and table-column alignment.
- [Resolved P2 · accessibility] A pointer-only drag interaction would exclude keyboard users.
  - Location: every Watchlist drag handle.
  - Fix: added a keyboard reorder mode: Space or Enter picks up/drops, Arrow Up and Arrow Down move within the current flag tier, and Escape cancels. The handle exposes its grabbed state and a polite live region announces each action.
  - Post-fix evidence: the picked-up handle reports `aria-pressed="true"`, the row receives a visible active treatment, and the live region announces the page name and available keys.

### Source visual truth

- Browser annotation: comment 1 on `http://localhost:3001/watchlist`.
- Captured starting state: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-drag-reorder-before.png`
- Source pixels: 1558 × 1187, normalized browser capture from a 1569 × 1196 CSS viewport at device pixel ratio 2.2.
- State: dark theme, default Watchlist order, eight pages grouped Priority → Watching → Paused.

### Rendered implementation

- Local route: `http://localhost:3001/watchlist`
- Final implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-drag-reorder-after.png`
- Keyboard grabbed-state screenshot: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-drag-reorder-keyboard.png`
- Implementation pixels: 1558 × 1187 from the same viewport, density, page data, and restored default order.
- Full-view before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-drag-reorder-comparison.png`
- Focused table comparison: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-drag-reorder-focused-comparison.png`

### Fidelity surfaces

- Fonts and typography: passed. Page titles, URLs, flag labels, baseline text, and actions are unchanged.
- Spacing and layout rhythm: passed. The new handle occupies the existing 22 × 32px control slot, so all table tracks remain aligned and row height remains 69.18px.
- Colors and visual tokens: passed. Idle handles use the existing muted neutral treatment; hover, keyboard-grabbed, and insertion states use the established blue interaction tokens.
- Image quality and asset fidelity: passed. No raster assets changed; the handle uses the installed Phosphor `DotsSixVerticalIcon`.
- Copy and accessibility: passed. Each control has a page- and tier-specific accessible name, shared keyboard instructions, pressed state, and live announcements.

### Interaction and persistence checks

- A direct mouse drag moved Homepage below Pricing within Priority.
- A full Watchlist reload retained the pointer-reordered position.
- Space, Arrow Down, and Space reproduced the same move entirely from the keyboard and persisted after reload.
- Space, Arrow Up, and Space restored Homepage to the first Priority position; a final reload confirmed the original order.
- Cross-tier drops are ignored by the interaction logic and rejected by the reorder helper; focused tests cover before/after moves without crossing flag boundaries.
- The existing order endpoint and dashboard default-order behavior remain the persistence path.
- A clean browser reload reported no warnings or errors.

### Comparison history

- Initial comparison identified the annotated usability issue: two tiny arrow actions were required for each reorder step.
- The replacement keeps the table geometry intact while making the full row order directly manipulable.
- Post-fix full and focused comparisons show no P0, P1, or P2 regressions in table alignment, flag controls, baseline content, or actions.

### Verification

- `npm run lint`: passed
- `npm test -- --run`: 57 files, 269 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Watchlist · settings section introduction

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] Watchlist configuration controls began immediately after the page table without a section-level heading or explanation.
  - Location: boundary between the Watchlist page table and the Default chart device control.
  - Evidence: the starting capture moved directly from the Enterprise row to the first settings card; no `Settings` heading existed in the document.
  - Fix: added a semantic `h2` and concise supporting copy that explains the shared purpose of the display, performance-evaluation, and agent-readiness controls below.
  - Post-fix evidence: `Settings` renders at 20px/600 with a 13px description, aligned to the existing content column and separated from the first control group by 16px.

### Source visual truth

- Browser annotation: comment 1 on `http://localhost:3001/watchlist`.
- Captured starting state: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-settings-heading-before.png`
- Source pixels: 1558 × 1187, normalized browser capture from a 1569 × 1196 CSS viewport at device pixel ratio 2.2.
- State: dark theme, default Watchlist page, page table followed by the first two settings groups.

### Rendered implementation

- Local route: `http://localhost:3001/watchlist`
- Final implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-settings-heading-after.png`
- Implementation pixels: 1558 × 1187 from the same viewport, density, page data, and control state.
- Full-view before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-settings-heading-comparison.png`
- Focused settings-boundary comparison: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-settings-heading-focused-comparison.png`

### Fidelity surfaces

- Fonts and typography: passed. The new heading uses the existing page hierarchy with 20px/600 type; supporting copy uses the established 13px muted treatment and 1.5 line height.
- Spacing and layout rhythm: passed. The introduction shares the table and settings-card left edge, uses a 30px section break, and preserves a 16px gap before the first control card.
- Colors and visual tokens: passed. Heading and description reuse the existing text and muted tokens; no card or control colors changed.
- Image quality and asset fidelity: passed. No imagery or icon assets were introduced or modified.
- Copy and content: passed. The description accurately covers chart display, change evaluation, and agent-readiness defaults without duplicating the group-level help text.

### Interaction checks

- The new introduction is semantic, non-interactive content and does not alter control focus order.
- `Mobile first` could still be selected and persisted; `Desktop first` was then restored successfully.
- Browser diagnostics reported no warnings or errors.

### Comparison history

- Initial comparison identified one actionable P2 hierarchy issue: the configuration area had no section-level label or purpose statement.
- The heading and description were added without changing the page table or control-card layout.
- Post-fix full and focused comparisons show a clear Watchlist-to-Settings transition with no additional P0, P1, or P2 issues.

### Verification

- `npm run lint`: passed
- `npm test -- --run`: 57 files, 268 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Detail header · equal status cards and shared range selector

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] The compact Desktop and Mobile status cards had different intrinsic widths and more vertical separation than requested.
  - Location: detail-page `.page-status-cards`.
  - Evidence: the starting cards measured `74.98px` and `69.52px` wide with an 8px group gap.
  - Fix: changed the reusable status-card stack to a single max-content grid track so both rows stretch to the widest card, and reduced the inter-card gap to 4px.
  - Post-fix evidence: both cards measure exactly `74.98 × 65.75px`; the grid reports a `74.98px` track and a 4px row gap.
- [Resolved P2] The detail page still used the legacy four-button date-range segmented control.
  - Location: detail-page `.page-controls`.
  - Evidence: the source capture showed `3d`, `7d`, `30d`, and `90d` in a 167.26px control with `role="group"`.
  - Fix: replaced it with the reusable dashboard `SelectMenu`, using the same full labels and 138px trigger/menu dimensions.
  - Post-fix evidence: the trigger reports `role="combobox"`, displays `Last 7 days`, measures `138 × 34px`, and opens a left-aligned `138 × 140px` listbox 6px below it.

### Source visual truth

- Browser annotations: comments 1–2 on `http://localhost:3001/pages/home`.
- Captured starting state: `/Users/mmunger/fde-page-watcher/design-qa-detail-header-refinement-before.png`
- Source pixels: 1269 × 714, normalized browser capture from a 1280 × 720 CSS viewport at device pixel ratio 2.
- State: dark theme, Homepage overview, Desktop primary device, 7-day range, compact stacked status cards.

### Rendered implementation

- Local route: `http://localhost:3001/pages/home`
- Final closed-state screenshot: `/Users/mmunger/fde-page-watcher/design-qa-detail-header-refinement-after.png`
- Open selector screenshot: `/Users/mmunger/fde-page-watcher/design-qa-detail-range-open.png`
- Implementation pixels: 1269 × 714 from the same viewport, density, data, device, and range state.
- Full-view before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-header-refinement-comparison.png`
- Focused header comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-header-refinement-focused-comparison.png`

### Fidelity surfaces

- Fonts and typography: passed. Device/status type is unchanged; the range selector now uses the dashboard’s 14px full-label grammar.
- Spacing and layout rhythm: passed. Status cards share one exact width with a tighter 4px row gap; the selector retains the dashboard’s 34px height, 8px radius, and 6px menu offset.
- Colors and visual tokens: passed. Existing status tones and shared selector selected/highlighted/idle tokens are unchanged.
- Image quality and asset fidelity: passed. No raster assets changed; the selector continues to use the installed Phosphor caret and check icons.
- Copy and content: passed. Device and status text is preserved; date ranges now use the clearer shared `Last N days` labels.

### Interaction checks

- Pointer-open state shows all four options, with the current 7-day value selected and highlighted.
- The trigger and menu both measure 138px, and their left edges align exactly.
- `ArrowDown` opens the menu and advances the highlight; `Enter` committed `Last 30 days`; pointer selection restored `Last 7 days`.
- `Escape` closes the menu without changing the selected value.
- Browser diagnostics contained only development/HMR informational logs; no warnings or errors were reported.

### Comparison history

- Initial comparison found two actionable P2 issues: unequal status-card widths/8px row gap, and the legacy detail-page segmented range control.
- Fixes applied: max-content grid track with 4px gap, plus the shared `SelectMenu` with dashboard labels and dimensions.
- Post-fix full and focused comparisons show no additional P0, P1, or P2 drift in the header, toolbar, tabs, or overview layout.

### Verification

- `npm run lint`: passed
- `npm test -- --run`: 57 files, 268 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Watchlist · flag tones, manual ordering, and natural dates

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] Priority and Paused flag selections used the same neutral segmented-control treatment as Watching.
  - Location: every Watchlist `Flag for …` control.
  - Evidence: the source capture showed white text on the neutral `#22222b` indicator for all selected flags.
  - Fix: extended the reusable segmented control with option-specific selected tones, then applied the existing dashboard `flagChip` tokens to Priority and Paused.
  - Post-fix evidence: Priority renders `rgb(94, 160, 255)` on `rgba(59, 137, 255, 0.16)`; Paused renders `rgb(255, 154, 61)` on `rgba(255, 154, 61, 0.12)`. Watching remains neutral.
- [Resolved P2] The Watchlist had no manual ordering control, and its stored array could interleave Paused pages with Watching pages.
  - Location: Watchlist page table and dashboard default ordering.
  - Evidence: the starting capture placed Enterprise (Paused) above four Watching pages, while no row exposed an ordering affordance.
  - Fix: added compact up/down controls to every row, disabled them at flag-tier boundaries, persisted the complete page-id order through an atomic domain endpoint, grouped all stored pages Priority → Watching → Paused, and added the stored Watchlist position as the dashboard’s default within-tier sort key.
  - Post-fix evidence: Watchlist rows render in the required flag hierarchy; a browser interaction moved Homepage below Pricing, survived a full reload, and made Pricing the first dashboard row. The original order was then restored and persisted.
- [Resolved P2] A baseline timestamp leaked its raw UTC ISO representation into prose UI.
  - Location: Runtime Audit Page baseline label.
  - Evidence: the source capture showed `Captured 2026-07-20T23:20:53.268Z`.
  - Fix: added a shared natural-date formatter for prose UI and used it for baseline capture labels.
  - Post-fix evidence: the same value renders as `Captured 4 days ago`; existing natural calendar labels such as `Captured Jun 17` remain unchanged.

### Source visual truth

- Browser annotations: comments 1–3 on `http://localhost:3001/watchlist`.
- Captured starting state: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-ordering-before.png`
- Source pixels: 1558 × 1187, normalized browser capture from a 1569 × 1196 CSS viewport at device pixel ratio 2.2.
- State: dark theme, default Watchlist, eight pages, Priority/Watching/Paused flags visible, Runtime Audit Page carrying an ISO baseline timestamp.

### Rendered implementation

- Local route: `http://localhost:3001/watchlist`
- Final implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-ordering-after.png`
- Implementation pixels: 1558 × 1187 from the same viewport, density, page data, and default interaction state.
- Full-view before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-ordering-comparison.png`
- Focused table comparison: `/Users/mmunger/fde-page-watcher/design-qa-watchlist-ordering-focused-comparison.png`
- Dashboard propagation proof: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-manual-order-proof.png`

### Fidelity surfaces

- Fonts and typography: passed. Table, page title, URL, flag, baseline, and action type styles remain unchanged.
- Spacing and layout rhythm: passed. A dedicated 32px order-control column keeps the Page, Flag, Baseline, and Actions tracks aligned without changing row height.
- Colors and visual tokens: passed. Priority and Paused reuse the dashboard pill tokens exactly; Watching and disabled states retain the established neutral grammar.
- Image quality and asset fidelity: passed. No raster assets changed; the order controls use the installed Phosphor icon set.
- Copy and content: passed. Page, URL, flag, baseline, and action content is preserved; only the annotated machine timestamp was converted to natural language.

### Interaction and persistence checks

- Clicking `Move Homepage down` placed Pricing before Homepage within Priority.
- A full Watchlist reload retained that order.
- A clean dashboard load used the persisted within-tier order, showing Pricing, Homepage, then Designer.
- Clicking `Move Homepage up` restored the original order; a second reload confirmed the restore persisted.
- Tier boundaries are enforced: Homepage cannot move above the first Priority position, and the only Paused page cannot move up or down.
- Column sorting on the dashboard still overrides the flag hierarchy and manual order.
- A fresh browser tab reported no warnings or errors.

### Verification

- `npm run lint`: passed
- `npm test`: 57 files, 268 tests passed
- `npm run build`: passed, including TypeScript, the new `/api/pages/order` route, and production route generation

final result: passed

---

## Detail header · stacked, content-sized device status cards

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] Desktop and Mobile status cards were arranged horizontally.
  - Location: detail-page `.page-status-cards`.
  - Evidence: the starting container measured `210 × 101px` with `flex-direction: row`; both cards occupied the same horizontal row.
  - Fix: changed the reusable device-status container to a vertical column while preserving Desktop-first order and the existing 8px inter-card gap.
  - Post-fix evidence: the final container reports `flex-direction: column`; Desktop begins at `y=55.875px` and Mobile begins beneath it at `y=129.625px`.
- [Resolved P2] The stacked cards retained fixed `101 × 101px` square dimensions despite containing only two compact text rows.
  - Location: individual `DeviceStatusCard` tiles.
  - Evidence: the follow-up browser annotation selected the Desktop card and requested that both cards fit their content.
  - Fix: removed the fixed width and height, switched to intrinsic `max-content` width and `inline-flex` height, and retained the existing 11px inset with a deliberate 14px row gap.
  - Post-fix evidence: Desktop measures `74.98 × 65.75px`; Mobile measures `69.52 × 65.75px`. The status labels remain unwrapped and neither card has unused square-card space.

### Source visual truth

- Browser annotations: vertical stacking followed by content-sized card refinement on `http://localhost:3001/pages/home`.
- Original horizontal state: `/Users/mmunger/fde-page-watcher/design-qa-detail-status-stack-before.png`
- Intermediate stacked-square state: `/Users/mmunger/fde-page-watcher/design-qa-detail-status-stack-after.png`
- Captured pixels: 1269 × 714, normalized browser captures from the same 1280 × 720 CSS viewport at device pixel ratio 2.
- Requested final state: Desktop above Mobile, with each card sized to its two content rows.

### Rendered implementation

- Local route: `http://localhost:3001/pages/home`
- Final implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-detail-status-compact-after.png`
- Final implementation pixels: 1269 × 714 from the same viewport, density, page data, and device/status state.
- Horizontal-to-vertical comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-status-stack-comparison.png`
- Fixed-square-to-content-sized comparison: `/Users/mmunger/fde-page-watcher/design-qa-detail-status-compact-comparison.png`

### Fidelity surfaces

- Fonts and typography: passed. Device names, status labels, weights, sizes, and line treatment are unchanged.
- Spacing and layout rhythm: passed. Cards stack with the existing 8px group gap; 11px card inset remains intact; the detail title aligns with the top card.
- Colors and visual tokens: passed. Status border, fill, foreground, shape, and radius tokens are unchanged.
- Image quality and asset fidelity: passed. No image or icon assets changed.
- Copy and content: passed. Desktop and Mobile labels, status text, tooltips, and accessible names remain intact.

### Interaction and layout checks

- The expanded stack introduced no overlap with the summary, controls, tabs, or overview cards.
- Compacting the cards reduces the header footprint and moves the controls and content upward without changing their internal layout.
- Desktop remains first in DOM and visual order; Mobile remains second.
- Clean browser reload: no warnings or errors.

### Verification

- `npm run lint`: passed
- `npm test`: 55 files, 259 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Dashboard date-selector width annotation

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] The date-range menu was materially wider than its trigger.
  - Location: dashboard `SelectMenu`.
  - Evidence: the annotated open state measured 196px for the listbox and 138px for the trigger; viewport clamping also shifted the menu 6.28px left of the trigger.
  - Fix: set the dashboard menu width to the same 138px width as its trigger.
  - Post-fix evidence: the open trigger and menu both measure `137.9971px`; the width delta is 0 and the left-edge delta is below 0.01px.

### Source visual truth

- Browser annotation: comment 1 on the open `Dashboard date range` listbox at `http://localhost:3001/dashboard`.
- Captured starting state: `/Users/mmunger/fde-page-watcher/design-qa-selector-width-before.png`
- Starting-state pixels: 1558 × 1187, normalized browser capture from a 1569 × 1196 CSS viewport at device pixel ratio 2.2.
- Requested state: shrink the open listbox to match the selector trigger width.

### Rendered implementation

- Local route: `http://localhost:3001/dashboard`
- Open-state implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-selector-width-after.png`
- Implementation pixels: 1558 × 1187 from the same viewport, density, content, and open interaction state.
- Focused before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-selector-width-comparison.png`

### Fidelity surfaces

- Fonts and typography: passed. Option and trigger type styles are unchanged and the longest option remains fully visible.
- Spacing and layout rhythm: passed. Trigger and menu widths now match exactly; the existing 6px vertical gap, 5px menu inset, row heights, radii, and shadow are unchanged.
- Colors and visual tokens: passed. Selected, highlighted, idle, border, fill, and shadow tokens are unchanged.
- Image quality and asset fidelity: passed. No image or icon assets changed.
- Copy and content: passed. All four date-range options and the current selection remain intact.

### Interaction checks

- Mouse-open state renders all options without truncation.
- Current selection and right-aligned check remain visible.
- Viewport placement continues to align the menu and trigger left edges.
- Clean browser check: no warnings or errors.

### Verification

- `npm run lint`: passed
- `npm test`: 54 files, 256 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Dashboard header annotation refinement

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] The dashboard repeated low-value run metadata above the verdict.
  - Location: `.dashboard-verdict__eyebrow`.
  - Evidence: the supplied browser annotation selected the full `PAGE PERFORMANCE · 7 pages · PSI…` row and requested its removal.
  - Fix: removed the metadata row and the now-unused latest-run calculations while preserving the row-level successful-run labels.
  - Post-fix evidence: the refined DOM has no `.dashboard-verdict__eyebrow`; the verdict heading is now the section’s first and only content block.
- [Resolved P2] The Watcher ribbon was shorter than the Page Watch brand block.
  - Location: `.watcher-ribbon`.
  - Evidence: the initial browser measurement was 54px for the ribbon versus 72px for `.sidebar-brand`.
  - Fix: set the desktop ribbon to a 72px minimum height while preserving the compact 54px mobile treatment.
  - Post-fix evidence: both desktop elements measure `71.9957px` in the 1569px viewport.
- [Resolved P2] The verdict section needed twice its existing vertical inset.
  - Location: `.dashboard-verdict`.
  - Evidence: the initial section used 32px top and 28px bottom padding.
  - Fix: doubled the desktop padding to 64px top and 56px bottom, removed the obsolete heading top margin, and doubled the compact breakpoint inset to 50px/44px.
  - Post-fix evidence: computed desktop padding is exactly 64px/56px and the headline has a zero top margin.

### Source visual truth

- Browser annotations: three supplied screenshots for comments 1–3 on `http://localhost:3001/dashboard`.
- Captured starting state: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-header-spacing-before.png`
- Starting-state pixels: 1558 × 1187, normalized browser capture from a 1569 × 1196 CSS viewport at device pixel ratio 2.2.
- Requested state: metadata removed, Watcher ribbon aligned to the sidebar brand height, and verdict vertical padding doubled.

### Rendered implementation

- Local route: `http://localhost:3001/dashboard`
- Implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-header-spacing-after.png`
- Implementation pixels: 1558 × 1187, normalized browser capture from the same 1569 × 1196 CSS viewport and state.
- Focused before/after comparison: `/Users/mmunger/fde-page-watcher/design-qa-dashboard-header-spacing-comparison.png`
- Responsive inspection: 760 × 900 CSS pixels; metadata remains absent, ribbon stays at the existing compact 54px treatment, and verdict padding is doubled to 50px/44px.

### Fidelity surfaces

- Fonts and typography: passed. The verdict type family, size, weight, line height, and responsive scale are unchanged; only the requested metadata typography was removed.
- Spacing and layout rhythm: passed. Desktop brand and ribbon heights match, verdict insets are mathematically doubled, and the heading no longer carries spacing intended for the deleted eyebrow.
- Colors and visual tokens: passed. Ribbon, verdict, and table colors were not changed.
- Image quality and asset fidelity: passed. No image or icon assets were added, replaced, or altered.
- Copy and content: passed. The requested metadata and next-run copy are gone from the verdict section; recommendation and verdict copy remain intact.

### Verification

- Clean browser reload: no warnings or errors.
- `npm run lint`: passed
- `npm test`: 54 files, 256 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Segmented controls · status and neutral/device variants

### Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] Pointer selection could inherit a focus-visible match from an earlier keyboard interaction, showing the keyboard ring after a mouse click.
  - Location: shared segmented-control option.
  - Evidence: the first pointer-selected browser capture showed the 2px blue keyboard ring.
  - Fix: the reusable component now tracks keyboard versus pointer modality; pointer selection has no ring, while keyboard selection retains the specified 2px ring at 55% blue.
  - Post-fix evidence: pointer-selected computed `box-shadow: none`; keyboard-selected computed a 2px, 55%-blue shadow with no competing global outline.
- [Resolved P2] The shared sliding device indicator was inspected immediately after a key change and still showed its starting transform during the 160ms transition.
  - Location: neutral/device segmented-control indicator.
  - Evidence: the selected label changed to Mobile before the animated indicator reached its final offset.
  - Resolution: the settled-state check confirmed `translateX(96.8672px)`, the selected option width, and the required `0.16s` transition. No code defect remained.

### Source visual truth

- State sheet: `/Users/mmunger/Library/Application Support/CleanShot/media/media_QTJZrUuYSs/CleanShot 2026-07-24 at 17.39.06@2x.png`
- Source pixels: 3404 × 3661 at 2× density.
- Required variants and states: counted status group, neutral/device group, idle, hover, selected, zero-result, keyboard focus, recomputing, disabled device, and responsive behavior.

### Rendered implementation

- Local route: `http://localhost:3001/dashboard`
- Shared component: `/Users/mmunger/fde-page-watcher/src/components/segmented-control.tsx`
- Dashboard integration: `/Users/mmunger/fde-page-watcher/src/app/(app)/dashboard/page.tsx`
- Existing-toggle adapter: `/Users/mmunger/fde-page-watcher/src/components/bits.tsx`
- Default implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-segmented-controls-implementation.png`
- Full-width implementation screenshot: `/Users/mmunger/fde-page-watcher/design-qa-segmented-controls-implementation-1569.png`
- Focused source/implementation comparison: `/Users/mmunger/fde-page-watcher/design-qa-segmented-controls-comparison.png`
- Main comparison viewport: 1569 × 1196 CSS pixels at density 1.
- Responsive inspection viewport: 820 × 720 CSS pixels.

### Fidelity surfaces

- Status grammar: passed. Browser measurements confirm a 50px assembled height from 8px inset padding, 32px rows, 4px gaps, 10px container radius, `#101014` fill, and `#24242b` border.
- Status semantics: passed. Active-result options are ordered before empty options. Empty options render neither dot nor zero, remain in place, use `#45454e`, and are noninteractive.
- Status selection: passed. The selected hue uses the supplied 12% wash, 300-tint label, 500 weight, and tabular bold count. Neutral hover is visually distinct from selection.
- Loading stability: passed. Only the measured count slot changes to a 14 × 11 skeleton while the dashboard recomputes; labels and option widths do not move.
- Device grammar: passed. The track uses 3px padding and a 9px radius; options use 7px radii. The selected indicator uses `#22222b`, white text, `#c6c6d0` icons, and a 160ms slide.
- Disabled-device support: passed. Shared options accept `disabled` plus explanatory `title`; disabled copy and icons use `#3c3c45` and cannot be selected.
- Responsive behavior: passed. The status group remains one control and scrolls horizontally inside the existing table toolbar when its fixed option widths exceed the available space; active statuses remain first.
- Icons: passed. Desktop and mobile use the installed Phosphor icon set. No handcrafted SVG or placeholder asset is present.

### Interaction checks

- Exactly one enabled option per group is in the tab order.
- Arrow Right moved status selection from All to Agent gaps and moved the roving tab stop with it.
- Arrow Right from Agent gaps skipped all three disabled zero-result options and wrapped to All.
- Pointer selection produced no focus ring.
- Keyboard selection produced the specified 2px focus-visible ring and no global outline.
- Arrow Right moved the device selection from Desktop to Mobile; the indicator settled at the measured Mobile offset after its 160ms transition.
- Browser console: no warnings or errors.

### Reuse assessment

- `StatusSegmentedControl<T>` owns counted status behavior, tones, zero-result disabling, fixed measured widths, and the count-only loading skeleton.
- `SegmentedControl<T>` owns the neutral/device grammar, icons, disabled tooltips, roving keyboard navigation, and animated selection indicator.
- `DeviceSegmentedControl` is the named device alias.
- Existing `SegToggle` consumers now delegate to the shared neutral component, so detail-page, inbox, task, and watchlist controls inherit the same interaction and visual grammar.

### Verification

- `npm run lint`: passed
- `npm test`: 54 files, 256 tests passed
- `npm run build`: passed, including TypeScript and production route generation

final result: passed

---

## Reusable selector design QA

## Findings

No P0, P1, or P2 defects remain.

- [Resolved P2] Mouse-open incorrectly showed the keyboard focus ring in the first browser pass.
  - Location: reusable `SelectMenu` trigger.
  - Evidence: the initial mouse-open capture showed a 3px blue ring.
  - Fix: input-modality tracking now removes the ring on pointer input and enables it only after keyboard input.
  - Post-fix evidence: mouse-open computed `box-shadow: none`; keyboard-open computed a 3px shadow at 25% `--wf-blue`.

## Source visual truth

- State sheet: `/Users/mmunger/Library/Application Support/CleanShot/media/media_sGyct6LGHw/CleanShot 2026-07-24 at 17.33.09@2x.png`
- Source pixels: 2260 × 2032 at 2× density.
- Required states: default, hover, keyboard focus, loading, open, selected, highlighted, keyboard navigation, and viewport-aware placement.

## Rendered implementation

- Local route: `http://localhost:3001/dashboard`
- Reusable component: `/Users/mmunger/fde-page-watcher/src/components/select-menu.tsx`
- Browser viewport capture: 1269 × 714 CSS pixels at density 1.
- Open-state screenshot: `/Users/mmunger/fde-page-watcher/design-qa-selector-open.png`
- Keyboard-focus screenshot: `/Users/mmunger/fde-page-watcher/design-qa-selector-keyboard-focus.png`
- Focused comparison, reference left and implementation right: `/Users/mmunger/fde-page-watcher/design-qa-selector-comparison.png`
- The focused source crop was normalized to the implementation menu width so density and the surrounding state-sheet canvas do not distort the comparison.

## Fidelity surfaces

- Fonts and typography: passed. Trigger and option labels use existing WF Visual Sans at 14px with the requested `#e9e9ee` and `#c6c6d0` hierarchy.
- Spacing and layout: passed. Browser measurements confirm a 34px trigger, 8px trigger radius, 196px menu, 5px menu inset, 10px menu radius, 32px rows, 6px row radius, 6px trigger-to-menu gap, and aligned left edges.
- Colors and visual tokens: passed. Default, hover, selected, highlighted, focus, disabled/loading, and menu-layer colors map to the supplied values. Selected and highlighted rows remain visually distinct.
- Image and icon fidelity: passed. Chevron, spinner, and check use the installed Phosphor library. The calendar icon was removed. No handcrafted SVG, CSS drawing, or placeholder asset is present.
- Copy and content: passed. The dashboard uses `Last 3 days`, `Last 7 days`, `Last 30 days`, and `Last 90 days`.

## Interaction checks

- Mouse click opens and closes the menu without a focus ring.
- Keyboard input enables the 3px, 25%-blue focus ring.
- The menu opens with the committed value highlighted.
- Arrow Down moved the highlight from `Last 7 days` to `Last 30 days` while the selected row remained blue.
- Enter committed `Last 30 days`, closed the menu, and updated the dashboard’s 30-day table copy.
- Escape closed the menu without committing the highlighted value.
- The trigger switches immediately to the pending label and replaces the chevron with a spinner until the controlled value commits and the render settles; a controlled `loading` prop also supports asynchronous consumers.
- With a 320px viewport, the menu flipped above the trigger and preserved the required 6px gap.
- Pointer-outside dismissal and viewport scroll/resize repositioning are implemented.
- Browser console: no errors.

## Reuse assessment

- `SelectMenu<T>` accepts generic string or number values.
- Options support labels and disabled states.
- Consumers can set trigger width and menu width independently.
- The dashboard is the only current native selector use; it now consumes the shared component. Future selectors can use the same API without date-specific behavior or styling.

## Verification

- `npm run lint`: passed
- `npm test`: 53 files, 250 tests passed
- `npm run build`: passed, including TypeScript and production route generation

## Follow-up polish

- None required for this pass.

final result: passed

---

# Design QA — PSI anomaly rows in nightly detail

- Source visual truth: `/Users/mmunger/Library/Application Support/CleanShot/media/media_N8hiN9nByC/CleanShot 2026-08-03 at 09.24.11@2x.png` (nightly-detail table) and `/var/folders/jz/8c54r7y95vn_cmfvrt65_l200000gq/T/codex-clipboard-f40f7d90-71a3-470c-9c6b-c1446cc32b36.png` (approved anomaly treatment in history charts)
- Implementation screenshot: `/tmp/page-watcher-list-anomaly.png`
- Browser viewport: 1280 × 720 CSS px
- Source pixels: 1760 × 854 and 1790 × 1633; implementation pixels: 1269 × 714
- Density normalization: comparison used visible component proportions and token-level treatment rather than pixel-overlay matching because the supplied screenshots show different pages, dates, and crops.
- State: desktop History tab, last 7 days, two consecutive provider-anomaly rows, existing custom/task markers retained.

## Full-view comparison evidence

The nightly table retains the source hierarchy, grid columns, typography, row density, borders, and score/range treatment. Provider-anomaly rows now use the same amber semantic color as the chart anomaly bands, with a subtle tinted row background and an inset left rule. Trusted rows remain visually unchanged.

## Focused region comparison evidence

The marker column clearly labels each quarantined row as `PSI anomaly · excluded`. Observed Lighthouse medians use amber rather than normal score-status colors, while ranges retain the table's secondary text treatment. Existing green custom markers and violet task markers remain visible on the same anomaly row. The table note explains that these measurements are excluded from scoring.

## Required fidelity surfaces

- Fonts and typography: existing product type, weights, sizes, line heights, and table hierarchy are preserved.
- Spacing and layout rhythm: the original grid tracks, row padding, column alignment, borders, and responsive horizontal scrolling are preserved.
- Colors and visual tokens: the existing `C.amber`, panel, border, row-border, text, and faint tokens are reused; no new palette was introduced.
- Image quality and asset fidelity: no new raster, logo, illustration, or icon assets are required for this table state.
- Copy and content: anomaly labels and explanatory copy match the chart's established `PSI anomaly · excluded` language and explicitly distinguish observed data from trusted scoring data.

## Interaction and accessibility checks

- Two anomaly rows are present in the rendered fixture and expose `data-psi-anomaly`.
- Each score cell announces `observed`, its range, and `excluded PSI anomaly` through its accessible label.
- The anomaly row's Report action opens the stored nightly report successfully.
- Current render shows no development issue overlay; an earlier HistoryChart list-key warning was removed by rendering marker dots from the already-keyed visible-marker collection.

## Findings

No actionable P0, P1, or P2 differences remain. The implementation intentionally adds the missing anomaly rows and uses the established chart anomaly semantics without changing trusted scoring behavior.

## Comparison history

- Initial pass: anomaly rows rendered correctly, but the development preview exposed a pre-existing HistoryChart child-key warning.
- Fix: marker dots now render from `visibleMarkers`, eliminating null entries from that rendered list.
- Post-fix evidence: the nightly table renders two anomaly rows, the Report action works, and the current preview has no issue badge.

## Follow-up polish

None required for this scoped change.

final result: passed
