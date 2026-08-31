# Repair ledger

A **repair** is a change to code you did not come here to write, made because
`main` is already broken. Two sessions repairing the same breakage independently
is how `main` acquired duplicated fixes and, once, a pair of conflict markers
nobody resolved. This file is the one place a repair is claimed, and it is
claimed **before it is written**.

Read it before you start work. Add to it before you fix anything you do not own.

## Before you start

```
git fetch origin
git show origin/main:REPAIRS.md    # every claim that has landed
gh pr list --label repair          # every claim still in flight
```

The second command matters: a claim is minutes old before it reaches `main`, and
minutes is exactly the window in which two sessions collide. A `repair`-labelled
PR is a claim whether or not you can see its row on `main` yet.

## If the breakage you found is already claimed

**Do not write your own fix.** The row names the branch. Rebase onto it:

```
git fetch origin
git rebase origin/<claimed-branch>
```

If it has not landed yet and you cannot proceed without it, say so in your
report and stop. Waiting one round costs less than two fixes for one defect,
which is what `main` got the last time, and one of them survived as duplicate
code because git had no conflict to raise.

## If it is not claimed and you are taking it

1. **Add the row first.** Append an entry under _Open_ below, with the base sha
   you saw it at, the symptom, and the branch you will fix it on.
2. **Open the PR immediately** — draft is fine — and label it `repair`. The
   label is what makes the claim visible to a session that fetched a minute ago,
   and it waives the `base-branch-green` merge gate, because a repair is how a
   red branch becomes green again.
3. **Keep the repair in its own commit**, separate from any feature work in the
   same PR, so it can be reviewed or reverted on its own.
4. When it lands, move the row to _Landed_.

A repair is not a place to also fix the thing next to it. One defect, one row,
one commit.

---

## Open

### The per-page agent-ignore route has no caller in the app

- **Found by:** F6, on `chunk-f6`, at base `95d77a9`.
- **Not claimed, and deliberately not fixed here.** F6 came to write a result
  vocabulary and a narrowing collapse; deleting a route is neither, and R3 says
  a repair does not ride along in a feature diff. Recorded so the next session
  finds it already seen rather than rediscovering it.
- **Symptom:** `POST /api/pages/[id]/agent-ignores` and the `setAgentIgnore`
  method `src/components/store.tsx` exposes are both reachable, typed and
  tested, and no component calls either. The per-page override can only be
  exercised over HTTP.
- **What it is NOT:** dead storage. `page.agentIgnores` and
  `page.agentIgnoreRestores` are read by the seed, `normalizeState`, scoring,
  the watcher and the collector, so the route is the only unreferenced part.
- **Before anyone deletes it:** read DECISIONS.md 6, which F6 closed. A per-page
  ignore is a decided product concept — an override of a site-wide setting — and
  the absence of a caller is a missing surface, not proof the concept is gone.
  Whoever takes this should decide which it is rather than assuming.

### The retention doc-comment in `mutations.ts` sits above the wrong function

- **Found by:** C3, on `chunk-c3`, at base `95d77a9`.
- **Not claimed, and deliberately not fixed here.** Moving a comment is a
  one-line change, and a one-line change in somebody else's function is still a
  change C3 did not come to write. R3 keeps it out of the feature diff.
- **Symptom:** the comment reading "Withdrawing consent stops future requests;
  evidence already stored is retained" sits immediately above a SECOND comment
  and then `addAgentIssueTask`, which has nothing to do with consent.
  `setExternalAgentAuditEnabled`, which the claim is about, is declared after
  both and now carries a doc-comment of its own about the history it writes.
- **The behaviour claim is true** — withdrawal stops future requests and stored
  evidence is retained, and C3 asserts both. Only its placement is wrong, so
  this is a comment move and not a behaviour change.
- **Care needed:** the fix is to move the retention sentence onto
  `setExternalAgentAuditEnabled` and merge it with the doc-comment C3 added
  there, not to copy it — two statements of one retention rule is the drift that
  put it in the wrong place to begin with.

### The Ora note runs two sentences together on screen

- **Found by:** C3, on `chunk-c3`, while merging `origin/main` (`07834fa`).
- **Left open by C3, deliberately.** It is a one-character change in a line C3
  also edits, which is exactly the shape R3 warns about: a shared defect buried
  in a feature diff cannot be reviewed or reverted on its own.
- **Claimed by:** `ui-improvements-post-refactor`, at base `98177fc`.
- **Symptom:** in `settings/page.tsx`, `{SETTINGS_SYSTEM_CONTRIBUTES.ora}` is
  followed by ` Switching it on sends...` on the same line, and the leading
  space is dropped. The rendered note reads
  "...you have to switch on.Switching it on sends...", with the DOM showing
  `switch on.<!-- -->Switching`. Introduced by S9 (#93); no check reads rendered
  copy, so CI is green on it.
- **Cause — not what the symptom looks like.** "JSX drops a leading space" is
  not true, and a session that believes it will go looking for the wrong thing.
  JSX keeps the leading space on the first line of a text node; four probe
  routes against this app's own toolchain confirmed it. What drops the space is
  an **HTML entity elsewhere in the same text node** — here `Ora&apos;s`, two
  lines further down. Same paragraph with the entity spelled out as `Oras`
  keeps its space; with `&apos;` it loses it. It is an SWC behaviour, and it
  needs no newline: a single-line `{X} Ora&apos;s` loses the space too.
- **Only leading whitespace is affected.** A trailing space before an
  expression survives the entity — `previous {rangeDays} days.` in
  `pages/[id]/page.tsx` renders correctly and is NOT a defect. Recorded because
  it is the first thing a sweep turns up.
- **Scope — swept, one site.** Parsing every `.tsx` for a text node that
  carries an entity AND begins with a mid-line space next to an expression
  returns exactly this one. So a one-off in fact, though not for the reason
  first recorded: the file does use `{" "}`, three lines below the defect, which
  is why the retention sentence beside it has always rendered correctly.
- **Fix:** `{SETTINGS_SYSTEM_CONTRIBUTES.ora}{" "}` with the sentence moved to
  the next line. Verified in the rendered DOM, not just the diff:
  `switch on.<!-- --> <!-- -->Switching`.

## Landed

### Conflict markers committed into `DECISIONS.md`

- **Claimed by:** `fix/decisions-conflict-markers` / #91 — `d00940c`
- **Seen at:** `6f0076d`, still present at `70bfbb3` (`main`)
- **Introduced by:** `aeeca8b`, "Merge main (S8, PERSON fix) into S4", landed via
  PR #88
- **Symptom:** `DECISIONS.md` lines 3–13 are a literal unresolved merge
  conflict — `<<<<<<< HEAD`, `=======`, `>>>>>>> origin/main` — sitting in the
  intro paragraph. No check reads markdown, so CI was green on the commit that
  shipped it and is green on `main` now.
- **What the two sides are:** the `HEAD` side (from S4, `b9870b8`) dropped the
  count and says "product questions"; the `origin/main` side (from S8,
  `296106d`) still says "five previously-undefined product questions" and
  "a one-line edit". The file now has six numbered decisions, and decision 6 is
  not a one-line edit, so the un-counted wording is the one that is true.
- **Fix:** kept the un-counted wording, deleted the stale side and the three
  marker lines. Nothing else in the file was touched, and no decision's content
  changed — only the intro paragraph that the merge left doubled.

### F4's field rename left S7's callers and fixtures behind

- **Claimed by:** R2 (retroactive entry; the ledger did not exist yet)
- **Seen at:** `728eb6c` (`main`, red)
- **Branch / PR:** `chunk-r2` / #86 — `0d5b849`
- **Symptom:** F4 renamed a field and swept its own callers. S7's tests passed
  their fixtures the old shape. Neither branch touched the other's lines, both
  were green alone, and the merge result was red.
- **Repaired twice.** `chunk-f5` also fixed it, in `04c4c2e` ("finish F4's
  caller sweep over S7's files"), across three of the same four files. Git
  found no conflict and took both copies, which is why `bd73eb0` ("one PERSON
  caller per test file, not two", PR #87) had to follow and delete the
  duplicates. This entry is the reason this file exists.

### Duplicate `PERSON` const in three test files

- **Claimed by:** the F5/R2 double-repair above
- **Seen at:** `96964f9` (`main`, red)
- **Branch / PR:** `fix/duplicate-person-const` / #87 — `bd73eb0`
- **Symptom:** `digest-arrival.test.ts`, `digest.test.ts` and `webhook.test.ts`
  each declared the same const twice, one copy from each of the two independent
  repairs above.
