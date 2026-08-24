# Page Watch UX and jobs-to-be-done audit

Date: 2026-08-21  
Scope: dashboard, external alert contract, Pages, Inbox, page detail, Opportunities, History, Agent-readiness, Tasks, and Guide.  
Primary journey: receive an alert or open Page Watch, understand what changed, decide whether to act, create work, and verify the outcome.

## Executive verdict

Page Watch has a strong evidence engine and a promising commitment loop, but the interface is organized around measurement surfaces instead of user decisions. Users encounter the data model before they encounter a clear answer to three questions:

1. What needs my attention?
2. What should I do next?
3. Why should I trust that recommendation?

The product should not throw away its depth. It should place that depth behind a single, first-class **issue case** that carries diagnosis, confidence, remediation, task state, and follow-up evidence from detection through resolution.

The most damaging trust problems are semantic, not visual:

- The dashboard can say “Nothing regressed today” while also displaying “Sitewide regression verified.”
- A page can be labeled “stable” while the Inbox presents a new, visitor-corroborated issue without explaining the difference between trend health and an active finding.
- The Watcher can produce malformed or non-quantified phrasing such as “could recover about Observed,” making a sophisticated evidence system feel uncertain.
- “Impact” contains incomparable values such as “Observed,” “Field p75 620 ms,” and time savings, while “Effort” sometimes says “Needs review.”

These inconsistencies make users question the analysis even when the underlying collection is sound.

## Jobs to be done

### When I open the app normally

- Tell me whether anything requires a decision now.
- Show me the highest-value action, not every available measurement.
- Let me scan the rest of the portfolio without implying that every score change is equally important.

### When I arrive from an alert

- Take me directly to the issue that triggered the alert.
- Explain what changed, when it changed, who or what is affected, and why this crossed the alert threshold.
- Tell me whether the issue is confirmed, probable, or still being investigated.

### When I investigate an issue

- Give me a plain-language diagnosis before metrics and source names.
- Show the supporting and conflicting evidence in one place.
- Explain what Page Watch measured, what it inferred, and what it cannot know.
- Let me inspect sample counts, ranges, source timestamps, exclusions, and raw reports only when I need them.

### When I decide to act

- Give me a concrete remediation plan with steps, expected impact, effort, owner, and success criteria.
- Let me add that complete plan to Tasks without losing the evidence that justified it.

### When work is complete

- Record the change, schedule verification, and tell me whether the expected improvement actually appeared.
- Keep “done implementing” separate from “verified resolved.”

## Current flow and health

### 0. External alert — poor

The current daily digest payload reports confirmed regression pages, categories, and devices, but does not provide a Page Watch issue deep link or carry a diagnosis/remediation state. It starts a manual search rather than a guided investigation.

Named evidence limit: no live webhook or Slack alert was available to capture in this audit. The current payload contract was inspected in `src/lib/webhook.ts`.

### 1. Dashboard — mixed

What works: the dashboard attempts to summarize, offers a direct Inbox action, groups site-wide culprits, and distinguishes native Webflow hotspots.

What breaks: four different attention models compete—the Watcher recommendation, regression banner, narrative headline, and two culprit sections. They do not resolve to one prioritized queue, and their language can contradict.

### 2. Inbox — mixed

What works: Inbox is a useful decision boundary between detected findings and committed work. Grouping, sorting, descriptions, ignoring, and the direct task action are all sensible foundations.

What breaks: the row leads with taxonomy and evidence chips rather than the diagnosis. Impact and effort are not semantically consistent. The user can commit work before seeing a remediation plan, success criteria, or a single explanation of confidence.

### 3. Pages inventory — poor for prioritization, useful for analysis

What works: it is a rich comparison surface for expert users and retains mobile/desktop context.

What breaks: every row exposes trend labels, lab/field relationship, four Lighthouse categories, two devices, and agent readiness simultaneously. Stable pages dominate the scan. The view answers “show me everything” but not “where should I look?”

### 4. Page overview — poor

What works: the product clearly separates lab and visitor data, labels provenance, gives date-range control, and provides strong visual score history.

What breaks: the Overview is a long evidence report rather than an overview of page health. Page-level alert calibration appears in the diagnostic reading path. Recommendations sit below several large score and evidence sections, so the action is physically and conceptually last.

### 5. Evidence and current recommendation — mixed

What works: lab and visitor metrics are compared side by side, and the recommendation retains its evidence labels.

What breaks: “lab and visitor signals align” appears near a “visitor corroborated” recommendation without explaining whether the recommendation is older, metric-specific, or still current. The user has to reconcile timelines and scopes themselves.

### 6. Opportunities — mixed

What works: this is the strongest diagnosis/remediation surface. It includes detection evidence, confidence, first-detected timing, recurrence, and a recommended action.

What breaks: this information is separated from the Inbox card and task creation CTA. The same underlying issue is represented differently in Dashboard, Inbox, Overview, and Opportunities. “Acknowledge,” “Suppress,” “Ignore,” and “Add workaround to tasks” create overlapping lifecycle vocabularies.

### 7. History — good evidence, poor default depth

What works: ranges, baselines, prior-period comparisons, independent source completion, and retained reports are excellent trust-building evidence.

What breaks: this depth is too prominent before the user understands the issue. It should be the evidence ledger behind a diagnosis, not another place the user must visit to assemble one.

### 8. Agent-readiness — poor for actionability

What works: Kitesurf is explicitly described as diagnostic-only and excluded from Lighthouse, CrUX, baselines, and status. This is exactly the kind of boundary that builds trust. Categories and ignore controls are logically grouped.

What breaks: a failed check such as ACP is shown without a plain-language consequence, why it matters for this page, evidence details, or remediation. The most prominent available action is “Ignore,” which trains users to manage noise instead of solve problems.

### 9. Tasks — mixed

What works: the Inbox-to-Tasks transition is simple, and marking work done automatically creates a change marker and schedules follow-up measurement. That closed-loop verification is a product differentiator.

What breaks: tasks are still recommendation rows with a status. They do not carry an owner, due date, checklist, implementation notes, validation target, or explicit “done implementing” versus “verified fixed” state.

### 10. Guide — useful fallback, warning sign

What works: definitions are thoughtful, plain-language, searchable, and grouped.

What breaks: 63 glossary terms represent substantial product training overhead. The Guide should support edge cases; it should not compensate for core screens that require users to translate source names and lifecycle terms.

## Keep doing

- Keep the multi-source evidence model. Lighthouse, CrUX, Kitesurf, native-element detection, and retained reports create a uniquely strong diagnostic foundation.
- Keep strict source boundaries. Explicitly saying what does and does not affect status is excellent trust behavior.
- Keep evidence gates, recurrence counts, ranges, timestamps, confidence, and exclusions.
- Keep Inbox as a deliberate commitment boundary, not an automatically generated task dump.
- Keep change markers and 2/7/30-day follow-up measurement. This closes the loop from recommendation to verified outcome.
- Keep site-wide culprit grouping. One shared cause should become one issue case with affected pages, not several duplicate tasks.
- Keep expert drill-downs such as History and raw reports, but move them behind progressive disclosure.
- Keep semantic labels, regions, tabs, and visible focus treatment. The inspected DOM was generally well labeled for assistive technology.

## Stop doing

- Stop treating Dashboard, Inbox, page Overview, Opportunities, and Agent-readiness as separate explanations of the same issue.
- Stop leading with scores when the user arrived to decide what to do.
- Stop using “stable” as if it means “healthy.” Stable is a trend; a stable page can still be slow or have an active issue.
- Stop mixing configuration with diagnosis. Page alert calibration belongs in page settings or an advanced policy drawer.
- Stop asking users to compare source-specific labels before giving them a product-level verdict.
- Stop overloading “Impact” and “Effort” with values that use different units and meanings.
- Stop creating task rows without a remediation plan and verification target.
- Stop exposing every stable category and device by default in the Pages inventory.
- Stop adding terminology to solve terminology. Inline translation should handle the common path; the Guide should remain optional.
- Stop presenting “Ignore,” “Suppress,” and “Acknowledge” as near-equivalent noise controls. Define one lifecycle with clear consequences.

## Add

### 1. Make an issue case the primary object

Every alert-worthy finding should have one canonical issue case used everywhere. It should contain:

- **Diagnosis:** one plain-language sentence explaining the problem.
- **Why now:** what changed or crossed a threshold.
- **Affected scope:** page(s), device(s), and visitor segment/evidence scope.
- **Impact:** expected user or business consequence, plus measurable technical impact when available.
- **Confidence:** Confirmed, Probable, or Investigate.
- **Remediation:** ordered steps, effort, owner, and implementation notes.
- **Success criteria:** the metric and threshold that would count as improved.
- **Evidence ledger:** supporting, conflicting, stale, or missing evidence with dates and sample counts.
- **Lifecycle:** New → Accepted → In progress → Implemented → Verifying → Resolved/Returned.

Dashboard, Inbox, Tasks, and page detail should all render the same object at different depths.

### 2. Reframe the dashboard as an Action Center

Use three queues:

1. **Needs a decision** — verified or high-confidence new issues.
2. **In progress** — accepted work with owner and next step.
3. **Watching outcomes** — implemented changes awaiting 2/7/30-day validation.

Put “All pages” and the full score matrix in a secondary monitoring/inventory area. The home view should answer “what should I do?” within five seconds.

### 3. Give every issue a two-layer explanation

Default layer:

- What happened?
- Why does it matter?
- What should we do?
- How confident are we?

Expanded “How we know” layer:

- Lighthouse sample count, median, range, version, and warnings/exclusions.
- CrUX scope, window, p75, traffic sufficiency, and freshness.
- Kitesurf/native evidence and the boundary of its influence.
- Conflicting evidence and what would change the verdict.

This preserves trust without forcing every user to become a measurement expert.

### 4. Deep-link alerts into the issue case

The alert should include a Page Watch issue URL and a short explanation:

> Pricing mobile performance is confirmed slower. Visitor data agrees. Likely cause: global JavaScript blocking the main thread. Review the evidence and remediation plan.

The destination should preserve the alert context, highlight why the notification fired, and expose one primary action.

### 5. Turn recommendations into remediation plans

Before “Add to Tasks,” let the user review or edit:

- ordered checklist;
- owner/team;
- estimated effort;
- affected pages;
- expected impact and confidence;
- implementation notes or links;
- verification metric and target.

Adding to Tasks should copy the whole case, not only its title and chips.

### 6. Make status semantics explicit

Separate four concepts visually and verbally:

- **Trend:** improving, stable, regressing.
- **Current health:** good, needs attention, poor.
- **Evidence confidence:** confirmed, probable, investigate.
- **Work state:** new, accepted, in progress, implemented, verifying, resolved.

This removes much of the current apparent contradiction.

## Recommended information architecture

Primary navigation:

- **Action Center** — Needs decision, In progress, Watching outcomes.
- **Pages** — inventory and page health, optimized for comparison.
- **Issues** — canonical cross-page issue cases and lifecycle history.
- **Watchlist** — monitoring configuration.
- **Settings** — thresholds, integrations, and policy.

Within a page:

1. **Summary** — health, active issues, next action.
2. **Issues** — canonical issue cases affecting this page.
3. **Evidence** — trends, lab/visitor comparison, source ledger, raw reports.
4. **Agent access** — agent-readiness checks, each with meaning and remediation.
5. **Settings** — calibration and page-specific policy.

Tasks can remain a view inside Action Center or as a focused work-management view, but they should use the same issue object.

## Highest-impact sequence

1. Fix contradictory summaries and define the four status concepts.
2. Create one canonical issue case and render it in Dashboard, Inbox, page detail, and Tasks.
3. Add remediation steps, owner, success criteria, and Implemented → Verifying → Resolved states.
4. Replace the dashboard with the three-queue Action Center.
5. Move dense source evidence and configuration behind progressive disclosure.
6. Add alert deep links and “why this alert fired” context.
7. Simplify Pages and add inline explanations for remaining technical terms.

## Accessibility observations

Confirmed strengths:

- Major areas use headings, regions, tablists, tabs, and descriptive labels.
- Many icon-only controls have accessible names.
- Focus treatment was visibly apparent during keyboard-like navigation.
- Status is usually accompanied by text, not color alone.

Risks:

- The shared faint text color (`#6C6C72`) on panel backgrounds (`#131315`) has approximately 3.56:1 contrast, below the 4.5:1 requirement for normal text. It is used for small labels and metadata.
- Many chips and metadata labels are roughly 9.5–12 px, increasing reading effort even where contrast passes.
- Dense comparison rows and whole-row buttons can produce very long, repetitive screen-reader announcements.
- Charts contain small, low-emphasis labels that may be difficult at zoom or for low-vision users.
- The large number of adjacent ignore controls increases keyboard and assistive-technology navigation cost.

Verification limits:

- This was a desktop visual and DOM audit of the local demo dataset.
- Mobile reflow, 200–400% zoom, screen-reader output, full keyboard traversal, reduced-motion behavior, and live alert rendering were not tested.
- No production customer data or authenticated external alert channel was inspected.

## Bottom line

The measurement sophistication is not the problem. The product currently asks users to understand that sophistication before it earns the right to recommend an action. Reorganize the experience around a canonical issue case and a decision lifecycle, then let Lighthouse, CrUX, Kitesurf, and retained reports serve as the evidence behind that case. That will make the app faster to understand for non-experts while increasing—rather than reducing—the trust available to experts.

## Visual companion

The corrected native, editable visual audit is available in the personal Figma team:

<https://www.figma.com/board/cDeoGPc2ucdJ06V7lIV0jv>

The original screenshot appendix was stored in the removed `.audit` working directory and is not embedded in this recovered copy.
