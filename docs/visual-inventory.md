# Page Watch visual inventory

This document is a written map of the Page Watch interface. It describes the product from the outside in:

1. page or route;
2. section within the page;
3. component within the section;
4. visible and interactive pieces within the component.

The goal is to let a person or AI reconstruct the UI's information architecture, visual hierarchy, content model, states, and interaction logic without first reading the implementation.

## Scope and evidence

- Inventory date: August 4, 2026.
- Rendered locally from the current demo data, then reconciled against the route, component, state, and CSS source.
- Routes covered: `/`, `/dashboard`, `/pages/[id]`, `/inbox`, `/tasks`, `/watchlist`, `/settings`, and `/admin`.
- Dynamic counts are examples from retained collection data, not fixed UI copy.
- API-only routes, the Next.js development toolbar, and browser chrome are outside the product UI and are not inventoried.

## Product-level map

```text
Page Watch application shell
├── Sidebar / mobile navigation rail
│   ├── Brand
│   ├── Primary navigation
│   └── Next nightly run summary
├── Main route content
│   ├── Dashboard
│   ├── Page detail
│   │   ├── Overview
│   │   ├── History
│   │   ├── Opportunities
│   │   └── Agent-readiness
│   ├── Inbox
│   ├── Tasks
│   ├── Watchlist
│   └── Settings
└── Global overlays
    ├── Toast
    ├── Add page dialog
    ├── Change marker dialog
    └── Full report dialog
```

`/` is not a visual destination. It redirects to `/dashboard`, preserving an optional configured base path.

## Global visual language

### Canvas and surfaces

- The product is dark-only. The page canvas is near-black (`#0b0b0c`), the sidebar and elevated fields are slightly lighter, and cards use two closely spaced panel tones.
- Sections are usually contained in rounded cards with a one-pixel low-contrast border. Dividers separate card headers, rows, and footer actions.
- Large empty areas are intentional. Content is left-aligned in a broad main canvas, with tables allowed to stretch horizontally.
- The sidebar is 244 px wide on desktop. Main-page headers normally use 40 px horizontal padding; content sections use the same alignment line.

### Typography

- The primary typeface is Webflow's variable `WF Visual Sans`, with system sans-serif fallbacks.
- Page titles are approximately 27 px and semibold. Detail-page titles are approximately 25 px.
- Section titles are generally 13.5–15 px and semibold.
- Body and explanation text is 11.5–13.5 px in muted gray.
- Column headings and category labels use small uppercase text with increased tracking.
- Numbers, scores, savings, and counts receive stronger weight and semantic color.

### Semantic color and shape

- Blue: primary actions, active navigation, selected filters, and lab metric labels.
- Green: healthy scores, successful state, completed tasks, and custom change markers.
- Amber: measured impact, slow or active findings, warnings, and partial states.
- Red/pink: regressions, failing checks, and destructive affordances.
- Violet: culprit labels, agent-ignore state, and task-linked markers.
- Page change states are not color-only. Status shapes provide an additional signal: circle, triangle, or square, depending on status.

### Motion and focus

- Hovering interactive elements slightly brightens them; buttons lift by one pixel.
- Focus-visible outlines use bright blue and a three-pixel offset.
- Selected segmented controls animate a sliding indicator.
- Loading controls can show spinners or count skeletons.
- Reduced-motion preferences disable status pulses, spinners' motion, and most transitions.

## Shared application shell

### Sidebar

**Purpose:** establish product identity, provide persistent navigation, and keep collection timing visible.

**Desktop structure:**

- **Brand block**
  - Webflow square logo.
  - Product name: “Page Watch.”
  - Workspace label: “Brand Studio.”
- **Navigation list**
  - Dashboard.
  - Inbox, with the count of actionable Inbox recommendations.
  - Tasks, with the count of saved tasks.
  - Watchlist, with the total number of watched pages.
  - Settings, without a count.
  - Each item contains an icon, text label, optional count badge, and an active background.
- **Next nightly run card**
  - Eyebrow: “Next nightly run.”
  - Clock icon and `Daily · [local time] [timezone]`.
  - Explanation that the run uses up to five independent PSI runs per strategy plus one agent-readiness scan.

**Logic:**

- Navigation paths respect the configured application base path.
- Badges disappear when their count is zero.
- Inbox counts only recommendations that are currently actionable.
- On page-detail routes the responsive layout can visually collapse the sidebar to its icon rail, while the semantic navigation remains present.

### Mobile navigation

At 760 px and below:

- The sidebar becomes a sticky horizontal top bar.
- The schedule card and brand text disappear; the logo remains.
- Navigation items become horizontal, centered targets.
- At 480 px and below, visible navigation labels are visually hidden and icons carry the navigation.
- The main content becomes full width beneath the bar.

### Global overlays

#### Toast

**Purpose:** confirm a mutation or report a recoverable failure.

**Pieces:** fixed bottom-center container, green check icon, short message. It is an ARIA live status and dismisses automatically after about 2.8 seconds.

#### Modal shell

**Purpose:** common frame for add, marker, and report dialogs.

**Pieces:** dark scrim, centered rounded dialog, constrained width and height, internal scrolling, dialog label.

**Logic:** the first control receives focus, Tab is trapped, Escape closes, clicking the scrim closes, and focus returns to the triggering element.

#### Add page dialog

See the Watchlist inventory for its content and logic.

#### Change marker dialog

**Purpose:** create or edit a dated event on a page's history.

**Pieces:**

- Title: “Log a change marker” or “Edit change marker.”
- Explanation that a marker schedules 2-, 7-, and 30-day Slack follow-ups.
- Description text input.
- Date input.
- Cancel.
- Green Log marker / Save marker action.
- Red Delete marker action only in edit mode.

**Logic:** task-created markers are controlled by task completion and are opened through Tasks rather than edited as custom markers. Custom markers can be edited or deleted from the History table.

#### Full report dialog

**Purpose:** inspect the report behind one retained collection.

**Pieces:**

- Sticky dialog header with date, watched URL, and icon-only close button.
- Four score cards: Performance, Accessibility, Best Practices, SEO.
- Each score card contains a median and run range.
- “Raw PSI payload (object storage)” label.
- Scrollable monospaced JSON block.

**Logic:** the application fetches the stored raw report when a key exists. Imported or seed data receives an explicit stored-median summary instead of fabricated provider metadata.

### Shared controls

#### Segmented control

**Purpose:** switch a small, mutually exclusive set such as device, grouping, filter, visibility, or view.

**Pieces:** rounded group, individual buttons, sliding selected indicator, optional icon, optional count, optional semantic dot/shape.

**Logic:** disabled options are skipped. Arrow keys, Home, and End move selection with roving focus. Counted status filters show a loading skeleton while collection is running and disable zero-result states.

#### Select menu

**Purpose:** choose a date range without using the browser's native select styling.

**Pieces:** combobox trigger, current label, caret or spinner, portaled listbox, options, selected checkmark.

**Logic:** opens above or below based on viewport space, closes on outside click or Escape, supports arrow-key highlighting and Enter/Space selection, and temporarily disables while an asynchronous value is settling.

#### Classification chips

**Purpose:** explain why a recommendation matters and whether a direct action or workaround is available.

**Pieces:**

- Weighted metric, such as `LCP · 25%`.
- Culprit, such as Image format or DOM complexity.
- Actionability, such as Action available, Workaround available, No direct action, or Needs review.
- Guidance is platform-neutral and describes only changes the customer can make.

#### Field-evidence chips

**Purpose:** state how controlled Lighthouse measurements relate to real visitor evidence.

**States:** corroborated, field-only, aligned-good, origin context, or unavailable/partial. A separate lifecycle badge can mark an active field issue, verification, lab reproduction, resolution, or recurrence.

## Dashboard — `/dashboard`

### Page purpose

Provide a daily triage surface: identify the most important next action, summarize site health, expose recurring cross-page culprits, then give a sortable comparison of every watched page.

### Page-level layout

```text
Sticky Watcher ribbon
Optional measurement-incident banner
Large daily verdict sentence
Site-wide performance culprits
Optional native Webflow element hotspots
Dashboard table
└── filter/view toolbar
    ├── optional active-filter explanation
    ├── sortable header
    └── one row per watched page
Method note
```

### 1. The Watcher ribbon

**Purpose:** promote one next action above all other dashboard content.

**Components and pieces:**

- Eye icon.
- Uppercase “The Watcher” label.
- Divider.
- Narrative message naming a page, recommendation, and expected impact.
- Optional field-evidence chip.
- Primary triage action.
- Secondary “Open Inbox” link.

**Logic:**

- While a collection is running, the message changes to “Analyzing [n] pages…” and the primary action becomes a running indicator.
- A direct recommendation says “Start with…”. A workaround item says “Work around…”. Evidence-only findings are not promoted into customer triage.
- A visitor-only issue is framed as an investigation because field evidence is poor while lab evidence does not reproduce it.
- With no open recommendation, the ribbon becomes muted and shows the next collection window.
- The primary action saves a direct fix or viable workaround as a Task.

### 2. Measurement-incident banner — conditional

**Purpose:** prevent synchronized PSI environment movement from being mistaken for real page regressions.

**States:** possible anomaly, confirming, persistent anomaly, recovered, or verified sitewide regression.

**Pieces:** state title and an explanatory paragraph. Border/background tone is amber for uncertain/confirming, green for recovered, and red for verified.

### 3. Daily verdict

**Purpose:** translate row-level signals into one readable headline.

**Pieces:**

- Positive lead such as “Nothing regressed today.”
- Up to two most important clauses.
- Inline counts for slow desktop/mobile pages, regressions, agent gaps, or improvements.

**Logic:** count phrases are buttons. Selecting one changes the device if necessary, applies the corresponding table filter, and scrolls to the table. When every signal is clear, the headline becomes “All [n] pages are healthy.”

### 4. Site-wide performance culprits

**Purpose:** roll repeated page findings up by root cause for the selected device.

**Section header pieces:** title, selected device and evidence scope, lifecycle count summary.

**Culprit card pieces:**

- Culprit label.
- Page count, issue count, and oldest detection date.
- Small remediation-tone dot.
- Weighted metric chips.
- Counts of actionable issues, viable workarounds, or returned issues.
- Up to three page buttons, with a `+n more` remainder.

**Logic:** page buttons open that page directly on Opportunities. Empty state explains that no currently present culprits have enough retained diagnostic evidence.

### 5. Native Webflow element hotspots — conditional

**Purpose:** aggregate device-neutral problems found in published Webflow HTML.

**Hotspot card pieces:** title, total instances, page count, classification chips, optional acknowledged-page count, and page links.

**Logic:** the whole section is omitted when there are no native-element rollups.

### 6. Dashboard table

#### Toolbar

- **Status filter:** All, Agent gaps, Low performance, Regressions, Improvements.
  - Counted states are ordered before zero-result states.
  - Empty states are visibly disabled.
  - Counts may overlap because one page can match multiple conditions.
- **Device control:** Desktop or Mobile. This changes large scores, sparklines, delta calculations, culprit rollups, and device-specific filter counts.
- **Date range:** defaults to 7 days; alternative ranges are supplied by the shared range menu.
- **Active-filter summary:** appears only when filtered; states how many pages match and offers Clear filter.

#### Sortable header

Columns are Page, Change, Performance, Accessibility, Best practices, SEO, and Agent. First selection sorts descending; selecting the same column again toggles ascending.

#### Page row

**Purpose:** summarize one watched page and act as the link to its detail view.

**Pieces:**

- Page title.
- Monitoring flag chip: Priority, Watching, or Paused.
- Watched URL.
- Change stack:
  - Mobile Performance status.
  - Desktop Performance status.
  - Optional visitor-experience status.
  - Optional lab/field comparison status.
- Four category cells:
  - Sparkline across the selected range.
  - Selected-device score.
  - Oldest-to-newest delta when a baseline/range comparison exists.
  - Other-device abbreviated score underneath.
- Agent cell:
  - Readiness sparkline.
  - Percentage or em dash.
  - Passing/applicable count and ignored count, or “no scan in range.”

**Logic:**

- The entire row is keyboard- and pointer-activatable.
- Pending pages show em dashes rather than invented zero scores.
- One retained agent snapshot renders as a flat line and explains that direction appears after the next scan.
- Change compares the oldest and newest trusted nightly medians inside the selected range.

### 7. Method note

Explains range comparison, the selected-vs-secondary device relationship, overlapping filter counts, and that Agent is derived from recorded per-check history.

## Page detail — `/pages/[id]`

### Page purpose

Provide the full operational record for one watched URL: current status, historical evidence, actionable recommendations, diagnostic lifecycle, and agent-readiness checks.

### Persistent page header

#### Breadcrumb

- “Pages” button returns to Dashboard.
- Slash separator.
- Current page title.

#### Identity block

- Page title.
- Optional development-only status-preview chip.
- External watched-URL link with arrow icon.

#### Status line

- Desktop Performance change: dot, device label, lowercase status.
- Divider.
- Mobile Performance change.
- Divider.
- Last successful PSI run timestamp, or a no-successful-run message.

#### Controls

- Primary device: Desktop/Mobile.
- Page date range.
- Run now button.
  - Disabled for a paused page or an active non-failed collection.
  - Label progresses through Paused, Queued, Starting, Waiting for evidence, Running, or Run now.
- Green Marker button opens the change-marker dialog.

#### Tabs

- Overview.
- History.
- Opportunities.
- Agent-readiness.

The active tab is URL-addressable with a query parameter. Left/Right arrows cycle tabs. Tabs do not appear until an explicit baseline exists.

### Page-level banners and alternate states

- **Paused banner:** history and baseline remain, but new collection is disabled until the Watchlist flag changes.
- **Collection status:** queued, dispatching, waiting, running, or failed. It names retained independent tests, missing tests, retry timing, and provider detail when available.
- **Partial collection retained:** successful device and agent results remain; missing tests retry later.
- **Page not found:** back-to-dashboard control and removal explanation.

### Pending / no-baseline panel

**Purpose:** keep snapshots from being treated as an explicit benchmark.

**States:**

- No collection yet.
- Snapshot collected — baseline required.
- Paused before baseline.

**Pieces:** explanatory copy, Capture baseline, and Run now. Buttons reflect collection progress and become disabled while blocked. A captured snapshot can be described, but deltas and health classification do not begin until baseline capture.

### Overview tab

#### 1. Category score cards

One card each for Performance, Accessibility, Best Practices, and SEO.

**Card pieces:** category name, selected-device label and large score, delta chip, secondary-device label and smaller score, both baseline scores, and selected-device sparkline.

**Logic:** missing current evidence uses em dashes. Scores and line colors use score bands. Delta is range-based, not always the baseline difference.

#### 2. Performance sub-metrics

**Purpose:** expose the measurements behind the top-level Performance score.

**Header:** Lighthouse lab medians, selected device, date range, optional Lighthouse version.

**Metric cards:**

- First content / FCP.
- Visual progress / Speed Index.
- Main content / LCP.
- Main-thread blocking / TBT.
- Layout stability / CLS.

Each contains a formatted value, Good / Needs improvement / Poor rating, and sparkline. Lower is better. An empty state says sub-metric history begins with the next successful collection.

#### 3. Page alert calibration

**Purpose:** override team tolerances for noisy or business-critical pages.

**Team defaults state:** segmented source control and one-line summary of inherited regression points, confirmation scans, device policy, and finding-evidence runs.

**Custom state:** numeric controls for regression, confirmation scans, score floor, finding-evidence runs, minimum time saving, minimum transfer saving, plus device policy. Invalid ranges block Save calibration. Returning to Team defaults clears page overrides immediately.

#### 4. Visitor experience — optional

**Purpose:** compare lab medians to rolling 28-day Chrome UX Report p75 evidence.

**Pieces:** source/update context, comparison verdict, measurement values when available, explanation of lab-vs-field scope. An unavailable state explicitly says there is not enough Chrome visitor data.

This section disappears globally when Visitor experience is Hidden in Settings; collection continues in the background.

#### 5. Agent-readiness summary

**Pieces:** circular percentage ring, pass/applicable count, ignored count, methodology note, and chips for every failing check.

**States:** all passing, no applicable checks, no scan, or a populated failing list.

#### 6. Recommendations for this page

**Header:** title and “Measured impact or signal.”

**Recommendation row pieces:**

- Recommendation title and category.
- Applicable device labels.
- Classification chips.
- Field-evidence and lifecycle chips.
- Optional generated explanation.
- Measured time/transfer impact or structural signal.
- Action area:
  - Add to tasks for directly actionable work.
  - Add workaround to tasks when a viable workaround exists.
  - Ignore.
  - Or a lifecycle pill such as `In tasks · In progress`, Ignored, or Monitoring lifecycle.

Rows are filtered to the selected device unless a recommendation applies to both or has no device restriction.

### History tab

#### 1. Score-over-time panel

**Pieces:**

- Range-aware heading.
- Category control: Perf, A11y, BP, SEO.
- Explanation of stacked desktop/mobile charts, median ranges, baselines, previous-period medians, and anomaly bands.
- Separate Desktop and Mobile chart blocks with Latest values.

**Logic:** a chart requires at least two successful collections for that device. Provider-anomaly measurements remain visible as orange diagnostic bands but are excluded from scores, trends, and recommendations.

#### 2. Compact visitor-experience comparison — optional

Shows the same lab/field model within the historical context for the selected device.

#### 3. Agent-readiness history

**Pieces:** latest percentage and count, legend for fixed checks and newly ignored checks, historical chart, point-level inspection controls, and threshold reference.

**Logic:** each point freezes the score and ignore settings effective at collection time. A single point is valid but cannot imply direction.

#### 4. Nightly detail table

**Header pieces:** selected primary device, Lighthouse median/range explanation, optional CrUX columns, anomaly explanation, and configured timezone.

**Columns:** Night, Marker, Perf, A11y, BP, SEO, optional LCP/INP/CLS/TTFB, and Report.

**Collection row pieces:**

- Local date and time.
- Run kind: Nightly, Manual, Confirmation, or generic Collection.
- Independently completed tests: Mobile PSI, Desktop PSI, CrUX, Agent.
- Marker(s).
- Score median and run range for each category.
- Optional visitor p75 value and movement from the prior CrUX snapshot.
- Report button.

**Logic:**

- Rows are reverse chronological and limited to the newest 12 in range.
- Repeated runs on one local date use an indented time label.
- Missing device evidence shows an em dash and disables Report.
- Task markers link to the corresponding Task and scroll it into view.
- Custom markers open the edit-marker dialog.
- Anomaly rows receive an amber inset and `PSI anomaly · excluded` marker.

### Opportunities tab

#### 1. Header and summaries

- “Failing audits & opportunities.”
- Selected-device explanation.
- Lifecycle counts: Returned, Active, Verifying fix, Resolved.
- Reminder that resolution requires two consecutive clean captures.
- Actionability counts: actionable, workarounds, no direct action, and need review.

#### 2. Culprit evidence

**Purpose:** explain why the score moved using privacy-safe medians from warning-free Lighthouse reports.

**Evidence cards may include:** DOM structure, unused CSS, third-party JavaScript, render-blocking resources, oversized images, and the LCP element.

**Card pieces:** evidence type, primary measurement, movement from previous snapshot, up to three supporting facts, optional top hosts/element description, and trusted-run count.

Empty state says the next collection will capture DOM, CSS, scripts, resources, images, and LCP details.

#### 3. Native Webflow elements

**Purpose:** expose problematic Background Video, YouTube/Vimeo, Lottie, Spline, or unresponsive raster footprints found in published HTML.

**Finding pieces:** title, lifecycle badge, classification chips, confidence, human explanation, detection evidence counts, recommended action, lifecycle chronology, instance count, Acknowledge/Clear acknowledgement, and Suppress.

**Logic:**

- Suppressed findings move to a separate group and are excluded from dashboard hotspots and future recommendations.
- Cleared findings remain visible in an evidence-history group.
- Scan-unavailable, awaiting-scan, and clean-scan empty states are distinct.

#### 4. Audit rows

**Pieces:** tone dot, title, description, lifecycle badge, classification chips, category, trusted-run evidence, confidence, recommended action, first/last detection chronology, and measured impact.

#### 5. Cleared findings

Findings absent from the latest capture remain visible as Verifying or Resolved, with lifecycle evidence. No promoted diagnostics produces an honest empty state rather than a blank list.

### Agent-readiness tab

#### Summary bar

- Recording date or no-scan message.
- Reminder that Watchlist defaults apply unless overridden.
- Counts for passing, failing, ignored, and unavailable checks.

#### Check-group cards

Groups are Discoverability, Content Accessibility, Bot Access Control, API / Auth / MCP, and Commerce.

**Group header pieces:** uppercase group name, optional Use default, Ignore category / Restore for page.

**Check-row pieces:**

- Status mark: ✓ pass, ✕ fail, or – ignored/unavailable.
- Check name.
- Optional unavailable or regressed badge.
- Optional Use default.
- Ignore / Restore.

**Logic:** page-level overrides can ignore a check or group, restore something ignored by the team default, or return to inheritance. Ignored checks leave the readiness denominator. If the scan could not reach the page, unavailable checks are explicitly not treated as failures.

## Inbox — `/inbox`

### Page purpose

Present untriaged, customer-actionable recommendations from the latest retained evidence and let the user commit or dismiss each one.

### Header

- Title: Inbox.
- Explanation that new recommendations can be saved as tasks or ignored.
- Descriptions control: Show / Hide.
- Group by: None / Page / Fix / Issue.

Description visibility is persisted in browser storage.

### Table header

- Recommendation, sortable.
- Impact, sortable.
- Effort, sortable.
- Actions.

### Group card

**Grouping behavior:**

- None: one ungrouped list; each row shows a page chip.
- Page: group header shows page title, URL, and item count.
- Fix: group header shows recommendation title, category, and count; each row names the page.
- Issue: group header shows culprit label, weighted metric context, and count.

### Recommendation row

**Pieces:**

- NEW badge.
- Title or page name, depending on grouping.
- Category and applicable-device labels.
- Optional generated description.
- Classification chips.
- Field-evidence and lifecycle chips.
- URL or page chip.
- Impact.
- Effort.
- Primary triage action.
- Ignore.
- Icon-only Open page.

**Logic:**

- Direct remediation becomes Add to tasks.
- A viable workaround becomes Add workaround to tasks.
- Evidence with no customer action remains in retained diagnostics and does not enter Inbox.
- Ignore removes the item from Inbox but retains it on the page detail.
- Field-only items are filtered through separate actionability rules.

### Empty state

Green check illustration, “Inbox zero,” and an explanation that new recommendations arrive after the next nightly run.

## Tasks — `/tasks`

### Page purpose

Track recommendations the team committed to and connect completion with page-change markers and scheduled follow-up evidence.

### Header and controls

- Title and lifecycle explanation.
- Descriptions: Show / Hide, persisted in browser storage.
- View: Columns / List.
- Group by: None / Page / Fix / Issue.

A `?task=[key]` link scrolls the matching card or row into view and highlights it in List view.

### List view

#### Header

Recommendation, Impact, and Effort are sortable; Actions is static.

#### Group card

Header shows the selected grouping label and item count. No grouping produces one continuous card.

#### Task row

**Pieces:**

- Small status-color dot.
- Recommendation or page title.
- Applicable devices.
- Optional description.
- Classification chips.
- Optional field-evidence lifecycle.
- Page chip linking to detail.
- Task status label.
- Impact.
- Effort.
- State actions.

### Columns view

Each group contains three columns: To do, In progress, and Done. A column header has a status dot, label, and count.

**Task card pieces:** page chip, title, devices, optional description, classification and evidence, impact chip, effort chip, completion date when done, and state actions.

**Logic:** cards can be dragged between columns. Dropping changes lifecycle immediately.

### Task lifecycle

- To do → Start → In progress.
- In progress → Back → To do.
- In progress → Mark done → Done.
- Done → Reopen → In progress.

Completing a task logs a conditional change marker on the page and schedules 2-, 7-, and 30-day follow-ups. Reopening or moving it out of Done removes that task marker and its follow-ups. Repeating the same Done action is idempotent.

The page currently has no dedicated empty-state card; with zero tasks the header and controls remain and the content area is empty.

## Watchlist — `/watchlist`

### Page purpose

Manage the set of monitored URLs, their priority tier, baseline state, and collection eligibility.

### Header

- Title: Watchlist.
- Explanation of Priority/Watching nightly monitoring and Paused history retention.
- Blue Add page action.

### Capacity summary

- Active used / maximum.
- Priority used / maximum.
- Total Paused.

Current limits are 10 active pages and 3 Priority pages.

### Watchlist table

#### Header

Drag handle, Page, Flag, Baseline, Actions.

#### Page row

**Pieces:**

- Six-dot drag handle.
- Editable page name.
- Locked watched URL.
- Flag segmented control: Priority / Watching / Paused.
- Baseline or collection-status text.
- View button.
- Red trash icon.

**Flag logic:**

- Priority and Watching collect nightly; Paused does not.
- Capacity-full choices are disabled and explain why in a title.
- A currently running page cannot be paused until its collection finishes.
- Changing flags also repositions the page within tier ordering.

**Baseline/status text can be:**

- History retained.
- Collection queued / collector starting / collection running.
- Waiting for independent test evidence.
- Failed-run label.
- Partial collection retained.
- Measurement inconclusive with the previous trusted score retained.
- Captured [date].
- No baseline yet.

**Editing logic:** click the title to replace it with a selected text input. Enter or blur saves a non-empty changed title; Escape cancels. The URL is intentionally locked.

**Ordering logic:**

- A page can move only within its current flag group.
- Pointer dragging shows before/after drop targets.
- Keyboard: Space/Enter picks up, Up/Down moves, Space/Enter drops, Escape cancels.
- Live-region announcements report pickup, movement, boundary, drop, and cancellation.

**Removal logic:** the trash action removes the page, its recommendations, and related follow-ups immediately, then confirms with a toast. There is no intermediate confirmation dialog in the current UI.

### Add page dialog

**Pieces:**

- Title and explanation.
- URL input with example placeholder.
- Page title input.
- Inline lookup status.
- Optional capacity warning.
- Cancel and Add page.

**Logic:**

- After URL typing pauses for 600 ms, the app attempts to discover the page title.
- Manual title editing stops automatic replacement.
- Lookup states are Looking up, Page title found, or unavailable with a request for manual entry.
- Title and URL are both required.
- If all active slots are occupied, the dialog warns that the page will be added Paused.
- A new page starts pending with no fabricated baseline, history, or scores.

## Settings — `/settings`

### Page purpose

Configure connected Webflow evidence, display preferences, collection schedule, monitoring thresholds, and global agent-readiness exclusions.

### 1. Webflow activity

**Purpose:** connect one Webflow Enterprise site so activity and publish evidence can be retained for future verification.

#### Loading state

“Checking connection…”

#### Disconnected state

- Webflow Site ID: required 24-character hexadecimal value.
- Site token: password input with required scope guidance.
- Connect Webflow button with Connecting state.
- Inline error alert.
- The token is described as encrypted by the collector and never returned to the app.

#### Connected state

- Connected badge.
- Summary grid: Site, Activity events, Last publish, Last sync.
- Latest publish evidence card: change density, change count, publisher, affected pages, timestamp.
- Latest activity card: event, operation, actor, resource, timestamp.
- Connection details card: Site ID, timezone, sync state.
- Optional last-sync failure.
- Reminder about automatic 15-minute sync.
- Disconnect and Sync now actions with busy labels.

Disconnect asks for browser confirmation and states that imported activity evidence will be retained.

### 2. Default chart device

**Purpose:** choose Desktop first or Mobile first when the application opens.

The preference changes both current route state and browser storage. Both device change labels remain visible regardless of primary selection.

### 3. Visitor experience data

**Purpose:** show or hide CrUX measurements throughout the UI.

Visible / Hidden changes presentation only; weekly collection continues.

### 4. Default collection time

**Pieces:** explanation, saved/default-state note, Local time input, timezone input with supported-timezone suggestions, and Save schedule.

**Logic:** Save activates only when the draft differs or no explicit override exists. The chosen time starts a collection window; pages and individual PSI samples are staggered after it.

### 5. Monitoring tolerances

**Purpose:** control the team defaults that drive dashboard filters, Watcher summaries, page status, alerts, and new Inbox findings.

**Section pieces:** explanation, Reset all, two-column control grid, validation/status message, Save changes.

**Reusable tolerance card pieces:** label, info tooltip, per-field Reset, numeric input, custom up/down stepper, and unit suffix.

**Controls:**

- Improvement threshold, in points.
- Regression tolerance, in points.
- Confirmation runs, in scans.
- Regression floor, out of 100.
- Device policy: Either, Both, Default preferred device.
- Agent-readiness cutoff, percentage.
- Metric-specific cutoffs: Performance, Accessibility, Best practices, SEO.
- New-page grace period, in completed post-baseline scans.
- Finding evidence, in repeatable runs.
- Minimum time saving, in milliseconds.
- Minimum transfer saving, in KB.

**Logic:**

- Tooltips explain each rule in operational language.
- Stepper buttons stop at supported minimum/maximum values.
- Per-field Reset returns one value to its team default draft; Reset all resets every draft.
- Save is enabled only for valid, dirty values.
- Invalid entries show an error message and cannot be saved.

### 6. Default agent checks to ignore

**Purpose:** remove globally irrelevant checks from every page's readiness denominator while still allowing page-level overrides.

**Section pieces:** explanation, `ignored / total` count, responsive grid of group cards.

**Group card pieces:** group name, Ignore category / Restore category, and check rows.

**Check-row pieces:** ✓ included or – ignored, check name, Ignore / Restore, or “ignored by category.”

Groups and checks match the Page detail Agent-readiness tab: Discoverability, Content Accessibility, Bot Access Control, API / Auth / MCP, and Commerce.

## Cross-page state and business logic

### Shared route state

- Primary device is shared across routes. The saved default is loaded from browser storage after hydration.
- Date range is shared while navigating within the mounted app, but resets to 7 days after a full reload.
- Inbox and Task description preferences persist in browser storage.
- Dashboard, Inbox, and Task sorts toggle descending/ascending independently and begin unsorted.
- Grouping and task-view choices are application-session state.

### Recommendation lifecycle

```text
Inbox
├── direct action ─────── Add to tasks ─────────────> Task / To do
├── viable workaround ── Add workaround to tasks ──> Task / To do
└── Ignore ─────────────────────────────────────────> Ignored on page detail
```

### Collection integrity

- Mobile PSI, Desktop PSI, CrUX, and Agent readiness are independent evidence streams.
- Successful partial evidence is retained.
- A page remains Pending until the user explicitly captures a baseline.
- Provider anomalies are retained for diagnosis but excluded from trusted status, trend, and recommendation calculations.
- Empty and unavailable states use words and em dashes rather than zero placeholders.

### Mutation feedback

- Most changes update optimistically, then reconcile with the server's authoritative state.
- Mutations are serialized so a slower earlier response cannot overwrite a later user choice.
- A failed request restores the previous state and shows a failure toast.
- Actions such as task advancement, ignore toggles, flag changes, and removal are immediate; only Webflow disconnect currently uses a browser confirmation.

## Responsive behavior

### 1180 px and below

- Four-column dashboard culprit grids become two columns.
- Culprit-evidence cards become two per row.
- Page controls can wrap.

### 760 px and below

- Sidebar becomes the sticky horizontal navigation bar described above.
- Page headers stack title and controls.
- Main content padding reduces from 40 px to 18 px.
- The Watcher ribbon sticks below the mobile nav, hides its text label/divider, and becomes shorter.
- Dashboard headline scales down.
- Settings tolerance grid becomes one column.
- Webflow connection grids/forms become one column.
- Detail status metadata wraps; run time moves to its own row; tabs scroll horizontally.
- Data tables retain a minimum width and scroll horizontally rather than collapsing their columns.
- Task columns retain three lanes with horizontal scrolling.

### 480 px and below

- Dashboard culprits and evidence cards become one column.
- Open Inbox disappears from the Watcher ribbon to preserve space.
- Detail separators disappear and the URL/status stack wraps more aggressively.
- Sidebar navigation labels become visually hidden, leaving icon-based targets.

## Implementation anchors

The inventory corresponds primarily to these files:

- Application frame: `src/app/(app)/layout.tsx`, `src/components/Sidebar.tsx`, `src/components/overlays.tsx`.
- Dashboard: `src/app/(app)/dashboard/page.tsx`.
- Page detail: `src/app/(app)/pages/[id]/page.tsx`.
- Inbox: `src/app/(app)/inbox/page.tsx`.
- Tasks: `src/app/(app)/tasks/page.tsx`.
- Watchlist and Settings: `src/app/(app)/watchlist/page.tsx`, `src/components/webflow-connection.tsx`.
- Shared controls: `src/components/bits.tsx`, `src/components/segmented-control.tsx`, `src/components/select-menu.tsx`.
- Visual tokens and responsive rules: `src/app/globals.css`.
- Shared UI state and mutation behavior: `src/components/store.tsx`.
