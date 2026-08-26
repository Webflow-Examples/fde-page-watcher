# Product decisions pending sign-off

The implementation resolved five previously-undefined product questions. They
are reasonable defaults, but they should be confirmed (or changed) by product
rather than remaining implicit in the code. Each notes where it lives so a
change is a one-line edit.

## 1. Status is driven by mobile Performance only

Page status is classified from the **Performance** category on the **mobile**
strategy. Accessibility, SEO, Best Practices, and desktop scores are shown and
tracked but do not change status. The four status values (currently Stable /
Improving / Regressing / Pending) are a UI vocabulary, not a product decision;
treat `statusMeta(...)` in `src/lib/scoring.ts` as the single source of truth
for their labels rather than restating them here, so this doc can't drift from
the code again.

- Where: `classifyStatus(...)` default `key = "perf"`; callers pass `"mobile"`.
  `src/lib/scoring.ts`, `src/lib/store/fsStore.ts`.

## 2. Drop threshold is 8 points

A category is considered to have a real drop (vs. noise) when it falls **8 or
more points** below baseline. Used for degraded classification, drop alerts, and
the "dropped on X" Watcher bullets.

- Where: `DROP_THRESHOLD = 8` in `src/lib/scoring.ts`.

## 3. Noise band is `max(4, 2 × mean night-to-night movement)`

"Improving" vs "Stable" (see `statusMeta(...)` in `src/lib/scoring.ts` for the
current status vocabulary) uses a per-page, per-category noise band: twice the
mean absolute night-to-night movement of the median, floored at 4 points so a
flat history still tolerates normal PSI jitter.

- Where: `noiseBand(...)` in `src/lib/scoring.ts`.

## 4. Collection starts at the workspace's saved local time

The first watched page initializes the workspace to **midnight in that user's
browser timezone**. The Settings screen can override both time and IANA
timezone. Active pages receive stable offsets after the chosen start so the
workspace does not burst every page or PSI sample simultaneously.

- Where: `src/lib/collectionSchedule.ts`, the Settings screen, and the
  collector's 15-minute due-page cron.

## 5. Sensitivity is one control with three positions (option 10b)

What a site considers worth reporting is **one setting**, not twelve. The three
positions are Only big moves / Normal / Everything, and each resolves to a
complete threshold set. The limits it resolves to are **displayed beneath the
control, in the strings the digest itself writes**, so the abstraction is never
opaque: a reader who wants to know why a line said "above the 250 ms you set"
can see the 250 ms and see which position put it there.

What the numbers are at each position is the part product should confirm. What
is settled, and should not be reopened without a decision:

- **Twelve per-metric thresholds** were rejected. Every number honest, and
  nobody could say what any of them would do to tonight's digest.
- **No thresholds at all** were rejected. The digest's threshold clause is the
  reason a reader trusts the line, and it needs a setting behind it to be true.
- **Per-page sensitivity** does not exist anywhere. S3 removed the page-detail
  calibration panel and S8 gives it no new home; a site has one answer to "what
  is worth telling you" because the digest that asks it is one message per site.
- **No position resolves the savings gate to 0.** At 0 there is no limit the
  reader set, so the digest withholds the clause and there is nothing to show
  under the control. "Everything" is 1 ms, which is every measurement there is.
- A site whose thresholds were hand-tuned before this landed is **mapped to the
  nearest position and told once**, in the digest footer. Discarding somebody's
  configuration silently is worse than the configuration was.

- Where: `SENSITIVITY_THRESHOLDS` in `src/lib/sensitivity.ts` is the only place
  the numbers appear; `DEFAULT_PERFORMANCE_THRESHOLDS` reads the Normal position
  from it. The migration is `normalizeState` in `src/lib/store/normalize.ts`.
