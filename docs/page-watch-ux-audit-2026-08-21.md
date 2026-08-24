# Page Watch UX and jobs-to-be-done audit

Original audit: 2026-08-21  
Updated: 2026-08-24 to incorporate Ora and the Is Agentic essentials model.  
Scope: dashboard, external alert contract, Pages, Inbox, page detail, Opportunities, History, Agent Access, Tasks, Guide, Page Watch HTTP checks, Kitesurf, Ora, and Is Agentic.  
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

Adding Ora does not change this conclusion; it makes the decision layer more important. Ora can provide stronger applicability, broader behavioral checks, evidence-backed remediation, and selective post-fix verification. Is Agentic is a website-focused Essential/Recommended/Bonus interpretation of the same underlying Ora scan. If these are exposed as additional scores, tabs, and finding lists, Page Watch will intensify the overload identified in this audit. They should instead strengthen canonical issue cases behind a single Page Watch verdict.

Page Watch should therefore act as the interpreter of four distinct evidence layers:

- **Page Watch HTTP checks:** frequent, deterministic evidence for an exact watched page and its origin resources.
- **Kitesurf:** rendered-page DOM, accessibility, network, runtime, and control evidence.
- **Ora:** independent, origin-level, applicability-aware audit evidence and remediation.
- **Is Agentic essentials:** Ora's simplified website-focused interpretation, not a separate scan.

These readings should never be averaged. Their value comes from independent corroboration, clear scope, and an evidence ledger that explains agreement, disagreement, freshness, and limitations.

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
- Explain whether evidence is page-level or origin-level and whether it came from Page Watch, Kitesurf, Ora, or the Is Agentic interpretation.
- Distinguish Failed, Partial, Not applicable, Unavailable, and Ignored instead of forcing everything into pass/fail.
- Let me inspect sample counts, ranges, source timestamps, exclusions, and raw reports only when I need them.

### When I decide to act

- Give me a concrete remediation plan with steps, expected impact, effort, owner, and success criteria.
- Let me add that complete plan to Tasks without losing the evidence that justified it.

### When work is complete

- Record the change, schedule verification, and tell me whether the expected improvement actually appeared.
- Re-run only the relevant Ora checks when an external finding was part of the diagnosis.
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

Ora sharpens the diagnosis of this problem. The current local model treats many emerging standards as failures when their signals cannot be observed or may not apply, leaving users to repair applicability through Ignore controls. Ora supplies explicit applicability and richer states such as Partial and Not applicable. Page Watch should adopt those semantics at the normalized issue layer while keeping existing local history backward compatible.

The improved experience must not become a provider score stack such as “Page Watch 72%, Is Agentic 63%, Ora B, Kitesurf Rendered.” It should lead with one product conclusion, one primary issue, and one next action. Provider readings belong in an expanded “How we know” ledger with scope and timestamps.

### 9. Tasks — mixed

What works: the Inbox-to-Tasks transition is simple, and marking work done automatically creates a change marker and schedules follow-up measurement. That closed-loop verification is a product differentiator.

What breaks: tasks are still recommendation rows with a status. They do not carry an owner, due date, checklist, implementation notes, validation target, or explicit “done implementing” versus “verified fixed” state.

### 10. Guide — useful fallback, warning sign

What works: definitions are thoughtful, plain-language, searchable, and grouped.

What breaks: 63 glossary terms represent substantial product training overhead. The Guide should support edge cases; it should not compensate for core screens that require users to translate source names and lifecycle terms.

## Keep doing

- Keep the multi-source evidence model. Lighthouse, CrUX, Kitesurf, native-element detection, and retained reports create a uniquely strong diagnostic foundation.
- Add Ora to that multi-source model as independent origin-level evidence; present Is Agentic essentials as an interpretation of the same Ora scan, not a separate provider run.
- Keep strict source boundaries. Explicitly saying what does and does not affect status is excellent trust behavior.
- Keep the local Page Watch HTTP scan for frequent page-level monitoring instead of replacing it with a slower external provider.
- Keep provider evidence independent. Corroborate findings, but do not average incompatible scores or rewrite one provider's historical result through another provider's methodology.
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
- Stop treating every absent agent standard as a failure. A provider- or policy-supported Not applicable state is different from Ignore.
- Stop collapsing Partial, Not applicable, Unavailable, and Ignored into pass/fail.
- Stop presenting the local pass percentage as a comprehensive agent-readiness verdict.
- Stop organizing Agent Access around provider names or adding separate Ora and Is Agentic tabs before explaining the diagnosed issue.
- Stop alerting on an external score change alone; methodology, applicability, freshness, or provider behavior can change without the site regressing.

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

For agent evidence, add a separate result vocabulary beneath those four product concepts:

- **Passed:** the applicable check succeeded.
- **Partial:** usable evidence exists, but the condition is incomplete.
- **Failed:** an applicable condition did not succeed.
- **Not applicable:** the surface or capability is not relevant to this site.
- **Unavailable:** the provider could not determine the result.
- **Ignored:** the user intentionally excluded an otherwise applicable result from Page Watch policy.

### 7. Add Ora as an external evidence provider, not a new destination

Integrate directly with Ora's versioned audit response and request the `include=essentials` interpretation used by Is Agentic. Keep the provider integration origin-scoped and independent of per-page Lighthouse collection.

The default Agent Access summary should read like:

> **Agent access needs attention**  
> Three essential blockers are supported by two independent sources.  
> **Primary issue:** Agents cannot reliably discover machine-readable API documentation.  
> **Next action:** Publish the OpenAPI document and expose it through the API catalog.

Expanded evidence can then show:

- Page Watch HTTP check, exact-page scope, and collection time.
- Ora check ID, origin scope, result, evidence, recommendation, and scan time.
- Is Agentic essentials score and methodology label.
- Kitesurf rendered evidence or availability state.
- Conflicting, stale, or missing evidence.

Use Ora's selected-check endpoint after an implementation so the relevant provider checks can confirm the result without rerunning unrelated work. Provider failure should leave the issue in Verifying and retryable; it must never mark the website as regressed or the remediation as unsuccessful.

### 8. Make external scanning an explicit trust boundary

Ora audits public sites and may retain normal scans in public history or directory surfaces. Page Watch should:

- require project-level opt-in before initiating external scans;
- strip queries, credentials, and fragments and normalize watched URLs to public origins;
- reject authenticated, private, preview, localhost, and network-local targets;
- disclose provider scope, freshness, storage behavior, and methodology-change risk;
- preserve the last successful snapshot when Ora is unavailable or rate-limited;
- deduplicate scans across watched pages that share an origin.

Cached reads and external refreshes should never delay or invalidate the normal Page Watch collection workflow.

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
4. **Agent access** — Page Watch verdict, active agent issues, and next action first; expandable Page Watch, Kitesurf, Ora, and Is Agentic evidence second.
5. **Settings** — calibration and page-specific policy.

Tasks can remain a view inside Action Center or as a focused work-management view, but they should use the same issue object.

Ora audit history belongs at the project/origin evidence level and should be reused by every watched page on that origin. It should not be copied into every page's nightly history. Page-specific Page Watch and Kitesurf evidence can attach to the same issue case with a narrower scope.

## Highest-impact sequence

1. Fix contradictory summaries and define the four product status concepts plus the six agent-evidence result states.
2. Add Ora as independent origin-level evidence with explicit consent, freshness, provider status, and no effect on normal collection completion.
3. Create one canonical issue case that deduplicates Page Watch, Kitesurf, Ora, and Is Agentic evidence.
4. Render the issue case consistently in Dashboard, Inbox, page detail, and Tasks.
5. Add remediation steps, owner, success criteria, provider check IDs, and Implemented → Verifying → Resolved/Returned states.
6. Add selective Ora verification for completed agent-readiness work.
7. Replace the dashboard with the three-queue Action Center.
8. Move dense source evidence and configuration behind progressive disclosure.
9. Add alert deep links and “why this alert fired” context; alert on new essential issues or corroborated regressions, not score movement alone.
10. Simplify Pages and add inline explanations for remaining technical terms.

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

The measurement sophistication is not the problem. The product currently asks users to understand that sophistication before it earns the right to recommend an action. Ora strengthens Page Watch only if it improves applicability, diagnosis, remediation, and verification behind the scenes. If Ora and Is Agentic appear as more competing scores and taxonomies, they worsen the central UX problem.

Reorganize the experience around a canonical issue case and a decision lifecycle, then let Lighthouse, CrUX, Page Watch HTTP checks, Kitesurf, Ora, Is Agentic essentials, and retained reports serve as evidence behind that case. Page Watch should own the conclusion, explain the source boundaries, and keep every provider's methodology and history intact. That will make the app faster to understand for non-experts while increasing—rather than reducing—the trust available to experts.

Implementation details for the Ora provider, storage, quotas, privacy, rollout, and verification loop are defined in [`docs/ora-agent-readiness-integration-plan.md`](./ora-agent-readiness-integration-plan.md).

## Visual companion

The corrected native, editable visual audit is available in the personal Figma team:

<https://www.figma.com/board/cDeoGPc2ucdJ06V7lIV0jv>

The original screenshot appendix was stored in the removed `.audit` working directory and is not embedded in this recovered copy.
