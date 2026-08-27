# DESIGN.md — Page Watch

How this app is designed, and the rules that decide arguments. Written for whoever
picks up a chunk next, human or agent.

The single source of truth for words is `vocabulary.json` — **v9**, 13 concepts,
21 rules. This file explains and points at it; where the two disagree, the
registry wins and this file is the bug.

---

## 1. The one idea

Every finding is an **issue case**: one record, one lifecycle field, one place a
decision is made. Before the rebuild the same problem existed as a
recommendation, a task, an opportunity and an agent finding, each with its own
status vocabulary — so the app contradicted itself and people stopped believing
it. Everything below exists to keep that from returning.

## 2. Navigation

Four destinations, no more:

| Route | Holds |
|---|---|
| `/issues` | every case, filtered |
| `/pages` | the page inventory |
| `/watchlist` | pages someone chose to be told about |
| `/settings` | the few dials worth having |

`/issues` carries four filters — **Decide · Fix · Watch · Show all** — as query
parameters, not path segments. A case is `/issues/[id]`; the id already
identifies a case, so there is no `/case/` segment.

Retired and redirecting to `/issues`: `/dashboard`, `/inbox`, `/tasks`,
`/guide`.

**Watch (a filter on Issues) is not the Watchlist (a destination).** They are
different things and the registry keeps them apart deliberately.

## 3. Lifecycle

Six states and one off-ramp:

```
new → todo → in_progress → fixed → resolved
 └──────────────────────────────────→ dismissed   (off-ramp, requires a reason)
        reopened ←── fixed | resolved | dismissed
```

Transitions are `accept`, `dismiss`, `start`, `mark_fixed`, `resolve`, `reopen`.
`resolve` has actor `system` — no button carries that label; the 30-day
checkpoint fires it.

**`actor` is a permission set, not an identity.** It says which classes of caller
*may* fire a transition. Who *did* is recorded separately and validated by
class. One word for both is rule 4's failure. (Chunk F4.)

### Checkpoints

`mark_fixed` schedules three: 2, 7 and 30 days. Each is `scheduled`, `agreed`,
`disagreed` or `unavailable` — never passed/failed, which belong to a *check*.
A checkpoint asks whether an earlier conclusion still holds, so it agrees or
disagrees with it.

- A disagreeing check fires `reopen` at once and the rest are cancelled.
- `unavailable` neither advances nor reopens; retry once at +24h.
- The 30-day check fires `resolve` if every reading taken agreed.
- Three unavailable readings leave the case `fixed`, saying so, with the only
  actions in the Watch queue.

The 2/7/30 schedule is **not configurable**. If a customer could set it to one
day, "Resolved" would mean different things at different customers.

## 4. Words

Four grammars, kept apart:

- **Conditions reached** — New, Fixed, Resolved
- **Activities underway** — In progress
- **Verbs for filters** — Decide, Fix, Watch
- **Verbs for actions** — Accept, Dismiss, Reopen, Start, Mark fixed

`banned_global` in the registry is lint-enforced across `src/`. A concept's
`banned_as_label` list is narrower — not a valid label *for that concept*, not a
banned word everywhere.

**Applicability is not lifecycle.** If a control decides whether something
*counts*, it is Exclude/Include with a reason — never a state. An excluded thing
keeps its last reading, greyed, with the reason next to it. Excluding is not
deleting; hiding evidence without saying why is how the agent tab lost trust.

### Plain language

Meaning first, term after: *"Content jumps around as this page loads
(cumulative layout shift 0.24)."* Never term-first, and one appositive per term
per screen. No tooltips as the pattern — most of this copy is read in a digest,
a ticket or a screenshot, where a hover does not exist.

## 5. Numbers

- **An absent measurement is not a small one.** No reading sorts *last* and
  renders "Not measured" — never 0, never blank, never folded as though it were
  small.
- **Absence withholds a claim; a broken invariant fails loudly.** A conclusion
  resting on a reading nobody took is simply not stated. A shape that should
  have been impossible throws and names what was malformed. Confusing the two
  trades a false claim for a crashed screen.
- **A group's number is the same statistic as its members'** — worst observed,
  never a sum. Adding measurements across findings invents a figure no run
  produced.
- Every number carries its unit, and a delta carries the window it was read
  over: `−14 pts over 30 days`.
- `lib/impact-format.ts` owns impact strings including "Not measured". A second
  copy of that string is a defect.

Evidence is a list of voices — `lighthouse`, `crux`, `native-elements`,
`agent-readiness`, `ora`, `kitesurf` — each in its own words, never averaged.
Any disagreement lands on **Unclear**, including three against one: a majority
verdict is a composite wearing one label.

## 6. Surfaces

**Two header patterns. A third is a bug.**

- *Destination header* — title, purpose line, one action. `/issues`, `/pages`,
  `/watchlist`, `/settings`.
- *Object-detail header* — breadcrumb, state chip and date, diagnosis title (max
  two lines), one explanatory paragraph, actions stacked right, metadata strip
  **below**. A case and a page.

Reading order on a detail page: what is wrong, what it costs, which pages, who
says so, what happened. Taxonomy never precedes the diagnosis.

**Page detail has no tabs.** One scroll: status, open cases, every reading.

**Group headings must be true of everything in the group.** "No change" holding
improved pages is false on the one line a reader scans.

**A count is a count, not a demand.** Watch carries no work, so its tab number
stays plain — same weight as the others, no accent.

**Empty is often the goal state.** "Nothing is waiting on evidence." No
illustration, no prompt to go and find work.

## 7. Colour and type

Tokens only. The C palette is deleted; there are no hex literals in `src/`
outside `manifest.ts`, which names the two tokens it mirrors.

**A token is named for its role.** A fill value used as ink, or a hairline value
used as type, is a bug even though it resolves — check contrast at the size and
surface it is actually used at, not the one it was designed for. An app layer
supplies the darker small-text steps Blueprint's `--text-success/-warning/
-danger` cannot carry below 16px:

```css
:root                  { --health-good-text: var(--green-1000); … }
[data-surface="dark"]  { --health-good-text: var(--green-200);  … }
```

Both themes pass WCAG AA on all text. An auto-discovery contrast test derives
its token lists from source rather than maintaining them, and fails if the
derivation degrades into a hand-kept list.

**12px is the floor.** Nothing carrying meaning renders below it — including
column headers, which are what tell a reader which column they are in. Status
chips are 12px, weight 600.

### Checkpoint notation

16px marks, differing in **shape** so colour can be removed without losing
meaning:

| Mark | Means |
|---|---|
| empty ring | scheduled |
| ring with a dash | unavailable — not possible, as against not yet |
| filled with a check | agreed |
| filled with a cross | disagreed |

The **next** scheduled check stretches into an 18px pill carrying its countdown
(`in 21 days`), in its chronological place in the run. Only ever one pill; its
border matches the unfilled ring so it reads as a stretched mark, while its text
uses an ink token because 12px at `neutral-600` fails AA.

The expanded track — three **equal** segments, one per check, with its outcome
and date — opens on **click**, never hover: hover-expand in a vertical list
moves the target the reader is aiming at. Same component in the Watch row's
drawer and permanently on the case detail.

## 8. Testing

**No DOM environment, and adding one is a program decision, not a chunk's.**
Adding jsdom means a lockfile change. It is not needed while the properties
worth guaranteeing can be made *data*: reading order is an exported ordered
array asserted directly, group order likewise. Make the thing you need to assert
into data rather than adding a machine to observe it — which is also how it
becomes the single statement of that fact.

This reopens only when a chunk needs **geometry** — overlap, wrapping, measured
contrast at a rendered size.

**A test asserts the decision, not the code.** `expect(state).toBe("resolved")`
passes whatever the registry says; `expect(state).toBe(taskStatusWorkState("done"))`
fails the moment the two halves disagree. A test naming a literal the registry
also names is asserting a mirror against a mirror.

**A fact stated twice is a defect waiting.** Where a second statement is
unavoidable — a pre-paint script that cannot import — the second copy carries a
test that *executes* or type-checks the two against each other. A comment asking
the next editor to keep them in step is not a mechanism.

Guards are verified by mutation: change the source, watch the test fail, restore,
watch it pass. Never widen a baseline to make a check pass.

## 9. Working on this

- **One branch per chunk.** Concurrent sessions in one tree have overwritten each
  other's files, inherited each other's failing tests and diverged on a route.
  A chunk needing another's work waits for its merge; that is what the
  dependency order in the chunk index is for.
- **Prompts are self-contained.** A prompt that points at a document the session
  cannot read is broken. Locked strings are inlined, generated from their source
  so the two cannot diverge — and regenerated whenever the source changes.
- **Run the checks at the base commit before starting** and report the sha. Do
  not inherit a failing-check list from an earlier report; it may already be
  cleared.
- **Every finding gets one disposition:** fixed here, handed to a *named* chunk,
  or accepted with a written reason.
- **Rule-shaped lessons become registry rules.** Rules 18–21 all came out of
  build reports rather than design sessions.
- Citations: chunk ids are `F1`–`F5`, `C1`, `C2`, `R1`, `W1`, `S1`–`S9`. R1's
  *findings* are also F-numbered, so outside R1's own doc a finding is cited as
  "R1 finding F5", never bare.

The chunk index in `Design Program.dc.html` is the live state — what is built,
what is designed, what is in flight, and what each chunk depends on. Blocks
lines and ordering there are derived from the dependency fields, not maintained
by hand.
