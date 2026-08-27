# Audit reconciliation review — findings

Independent review of `AUDIT-RECONCILIATION.md` (26 August 2026) against the
tree, the git history, and `vocabulary.json` v9.

**Reviewed at:** `95d77a98e77cafef99492d0964f5fb92e599a510` (local `main`, the
tip most closely matching the state the reconciliation describes).
**Checks at that sha:** `npm run lint` ✓ · `npm run typecheck` ✓ ·
`npm test -- --run` ✓ (104 files, 1335 tests) · `npm run build` ✓. The base is
green.

**A note on staleness before anything else.** `origin/main` is 12 commits ahead
of the reviewed sha. S9 (#93), F6 (#94) and C3 (#95) all merged on the evening
of 26 August, *after* the reconciliation was written — so its "designed and
unbuilt" for those three, and open items 1, 2, 4 and 5, have since been
actioned. That is not held against the document. What is held against it
survives on both tips: **S5 is merged on neither** (`git merge-base
--is-ancestor d543534 origin/main` fails), and the allowlist still has more
than one entry upstream (v10 carries `bits.tsx` and `store.tsx`).

## Verdict

**The reconciliation cannot be relied on as an account of what is merged, and
it can be relied on for almost everything else.** Its architecture claims — one
lifecycle field, registry-derived enforcement, no averaging, no summed impact,
fixed checkpoint schedule, the consent-before-target ordering — all verify
against the tree, most of them backed by property-shaped tests rather than
enumerations. Ten of its eleven divergences are real and accurately costed. But
the document's central bookkeeping figure is wrong: **18 chunks are merged, not
19.** S5 — the chunk behind divergence D4, which the document itself calls "the
divergence most likely to be felt as a loss" — sits complete on an unmerged
branch, while the ledger marks it Built and D4 describes its deletions in the
past tense. Two further section-08 "check these first" claims fail
mechanically, and two open items describe defects the tree had already fixed
the previous day. The pattern is the document's own failure pattern #2,
"carrying a stale premise forward," applied to itself: it was assembled from
session reports, and at least four of its claims describe a tree that no longer
existed when it was signed.

---

## Findings, ranked

### BROKEN

**B1 · S5 is not merged; "19 merged" is false; D4's "what shipped" did not ship.**
The reconciliation's header table says 19 of 22 merged with S9/F6/C3 the
unbuilt three. The audit-ledger row for Flow §9 marks S5 "Built" and says "The
route is deleted. Owner and started-date are written by Start; Copy as ticket
hands the work…". D4 repeats it: "The route, the due dates, the checklists and
the standalone verification endpoint are deleted."
The tree at the reviewed sha (and at `origin/main`):
- S5 exists as one commit, `d543534`, only on `chunk-s5`; `git cherry main
  chunk-s5` → `+` (not in main); not an ancestor of `origin/main` either.
- `checklist` still sits on the case type (`src/lib/issue-case.ts:215`) — the
  field D4 says was deleted.
- The standalone verification endpoint still exists
  (`src/app/api/agent-audits/verify/route.ts`).
- Nothing writes `owner`/`startedAt`; `src/components/copy-ticket-button.tsx`,
  `fix-queue.tsx`, `src/lib/fix-ticket.ts` do not exist on main.
- The leftover task producer survives: `addAgentIssueTask`
  (`src/lib/mutations.ts:289`) calling `promoteAgentIssueToTask`
  (`src/lib/agentIssueTasks.ts:97`), plus the store callback
  (`src/components/store.tsx:926`).
The `/tasks` route *is* a redirect — but that shipped with C1's chrome, not S5.
Open items 10 ("after S5 deleted the task route and its object") and 12 both
presume S5 landed, so this is not a typo in one cell; the document believed it.

**B2 · "Exactly one allowlist entry should remain" — three remain, and the
attribution is wrong.** Section 08: "S3, S4 and C2 each cleared one, so exactly
one entry should remain — `src/lib/guide.ts`." The registry at the reviewed sha
(`vocabulary.json:611-616`) carries **three**: `guide.ts`, `bits.tsx`,
`store.tsx`. Per the registry's own `$comment`, the clearing chunks were S3
(`pages/[id]`), **S8** (`watchlist`), and S4 (`agent-access`) — C2 cleared
nothing. The two extra entries belong to **merged** chunks: `bits.tsx` to F2
("Verifying/Returned belong to the lifecycles F2 deletes") and `store.tsx` to
S2 — both merged without clearing their entries, and the banned copy is still
in the files: `bits.tsx:75` ("Verifying recovery…"), `bits.tsx:113` ("Returned
after a confirmed resolution"), `store.tsx:1010` ("Saved to Tasks — track it on
the Tasks board"), `store.tsx:1029` ("cleared from Inbox"). Lint passes only
because the allowlist exempts them. To be fair to the registry: the history
shows the list only ever shrank (6 → 3 across v4→v9; upstream v10 is at 2), so
the "may only shrink" invariant held — the reconciliation's *count* is what is
wrong.

**B3 · Open item 2 / section-08 check five: "user-visible today" is false.**
"`externalAgentResultLabel` still exists and still renders 'Passing / Failing /
Not determined' on the same scroll as the registry's six words." The function
exists (`src/lib/externalAgentEvidence.ts:101`), but its only consumer,
`ExternalAgentAuditPanel` (`src/components/agent-audit.tsx:117`), **has no
importers** — dead code at the reviewed sha. At S4's own commit (`b9870b8`) the
panel was still mounted at `pages/[id]/page.tsx:1756`; S4's merges with main
(which carried S3's one-scroll rewrite, `8f56e46`) dropped the mount. F6's
premise was stale before F6 was built. Nothing rendered the second vocabulary
on any scroll at the sha under review.

**B4 · Open item 7: the two "unowned fabricated-reading sites" were fixed the
day before the document was written.** "`watcher.ts` substitutes 0 for an
absent perf delta and 100 in a sort comparator… nobody owns them. Needs a chunk
or a claimed repair." S6 fixed both — commit `4353a56`, merged 25 Aug via
PR #81, titled "…and fix two zeroes nobody measured", with rule-18 rationale
comments (`src/lib/watcher.ts:77` P35, `:342` P36), a guard exported for test,
and no `?? 0` / `?? 100` remaining on any score or delta in the file. The
recon's misassignment story ("nominally assigned to S7") is itself wrong: R1's
own report assigned P35 differently and S6's commit message names the fix.

**B5 · `/guide` does not redirect to `/issues`.** Claimed twice — the section
02 navigation diagram ("retired → /issues: /dashboard /inbox /tasks /guide")
and D3. The stub at `src/app/(app)/guide/page.tsx` redirects to
`/settings#reference`, and its own comment notes the `#reference` section is
not built, so the redirect lands on Settings with nowhere to scroll. (The
untracked `DESIGN.md` repeats the same false claim.) The other three retired
routes do redirect to `/issues` as claimed. Minor, but it is a mechanically
checkable claim about the tree, stated twice, and false.

### UNSOUND

**U1 · D3 and D4 present unshipped work under "What shipped".** D3's "What
shipped: the route and `lib/guide.ts` are both deleted" was false at signing —
`src/lib/guide.ts` existed (it went with S9, upstream, hours later). D3 is at
least internally contradicted by the ledger ("S9 — Designed") and open item 1,
so a careful reader can recover the truth. D4 has no such internal correction
anywhere in the document. For both, the *reasoning* sections are argued from
registry rules and are consistent with `DECISIONS.md`; I found no evidence the
stated reasons are rationalisations. The defect is tense, not motive — but in a
document that exists to be checked, "shipped" must mean shipped.

**U2 · Open item 1 overstates what `/guide` still does.** "63 technical terms
are still in the copy, and `/guide` still exists… to explain them." At the
reviewed sha the Guide UI is unreachable: the route redirects, and nothing
outside its own test imports `GUIDE_ENTRIES` (`grep -rln 'from "@/lib/guide"'
src` → test only). The glossary was already dead code, not a live crutch. Also
the count: `guide.ts` carried **70** term entries, not 63 — the glossary grew
after the audit (the Ora work added entries, e.g. `external-agent-audit` at
`guide.ts:471`). The S9-is-least-progressed conclusion stands; the description
of the cost does not.

### UNRECORDED

**R1 · The digest cadence control is inert, and the footer will state a cadence
nothing implements.** Settings renders a live Daily/Weekly segmented control
(`src/app/(app)/settings/page.tsx:195-200`) persisted through
`setDigestSettings` (`src/lib/mutations.ts:244-251`). Nothing in digest
creation or delivery reads it: `claimDailyDigest`
(`src/lib/dailyDigest.ts:117`) claims every ready digest regardless, and the
only consumer of the stored cadence is the footer string
(`src/lib/dailyDigest.ts:35-38` → `digest-copy.ts:207`, "`{Weekly} digest for
{site}`"). A site set to Weekly receives a digest every run, each one whose
footer says "Weekly digest". `digestCadence.ts`'s comment says the digest
should "state the cadence it is actually being sent on" — the writable setting
broke that property, which is the exact shape of registry rule 15's warning and
of D7's own worry, and no document records it. D7 says the weekly fallback "is
designed as 9c and unbuilt" without mentioning that a non-functional Weekly
*switch* shipped.

**R2 · `DESIGN.md` has never been committed.** `git log --all -- DESIGN.md` is
empty; it is an untracked local file (as is `brand/`). The programme's stated
process is that build sessions are separate and self-contained; the document
titled "decisions that survived… written for whoever picks up a chunk next" is
invisible to any session working from the repository. No document mentions
this.

**R3 · Two merged chunks (F2, S2) did not finish their allowlist obligations.**
Fold-in to B2, listed separately because no document records it as a defect:
each allowlist entry "names the chunk that clears it," F2 and S2 both merged,
and both entries remain with the violations live in the files. Whether the
`store.tsx` toasts are still reachable in the UI is unclear (their producer is
the leftover S5-era task path), but the registry's contract — entry cleared by
the named chunk — was not honoured, and nothing flags it.

### NOTED

**N1 · Section 06's version attribution is off by one against git.** The table
puts the rule-18 withhold/fail extension in v7 (R1) and `actor_note` in v8
(W1). Git: the rule-18 extension *is* v8 (`7570e0f`, "amend rule 18… (v8)"),
and `actor_note` first appears in the v9 install (`9eeec84`). The registry's
own v9 note ("two files were numbered 8 with different content") explains how
this happened; the seven-revision count (v2.1 pre-repo, then v4–v9 in git) is
right, and no rule was ever weakened — rules only grew 13→21, banned terms held
at 15, the allowlist only shrank.

**N2 · Two premise errors caught late is confirmed as a pattern, and F6's is
visible in the tree.** The prompt's F6/C3 26-August amendments cannot be
checked (chunk docs are not in the repo), but the tree independently corroborates
both premise problems: C3's (consent is one project-level boolean —
`types.ts:885`, `mutations.ts:306`, no record of who/when) and F6's (the
"renders on one scroll" premise was already false at base `95d77a9`, see B3 —
and F6's own upstream base-check found and recorded the caller-less per-page
agent-ignore route in `REPAIRS.md` rather than fixing it, which is the process
working as written).

**N3 · Bundled chunk branches.** `chunk-w1-s2`, `chunk-s3-s6-s7`, and the C1
PR (F1+F2+F3+C1 in substance) put several chunks on one branch, against the
untracked `DESIGN.md`'s "one branch per chunk". Merge *order* claims hold: the
foundations (#76/#77) merged before any screen chunk; S1 (#78) was the first
screen. The admitted orderings (S2 before F5, W1 before F4) are stated in
section 05 and are real, not new findings.

**N4 · `/scorecard-demo` is a live, undocumented route.** The "9 routes, was
11" accounting nowhere mentions it; it builds and serves
(`src/app/scorecard-demo/`). Demo scaffolding, probably deliberate, worth a
line somewhere.

---

## Section 04 — verdict on each divergence

| # | Claimed | Verdict against the tree |
|---|---|---|
| D1 | Verification state deleted, not named | **Holds.** `work_state` has no verifying/checking value; both are `banned_as_label` (`vocabulary.json:70-86`); checkpoints live inside `fixed` (`issue-case.ts:483-497`); lifecycle tests assert against the registry JSON, not mirrored literals (`issue-case.test.ts:42-50`). |
| D2 | Tabs removed, one scroll | **Holds.** No tab machinery in `pages/[id]/page.tsx`; S3 commit `8f56e46`. The claimed 5c fallback sketch is in chunk docs I cannot read. |
| D3 | Guide deleted | **Does not hold at the reviewed sha.** S9 was unbuilt; `lib/guide.ts` present; `/guide` redirects to `/settings#reference`, not `/issues` (B5, U1). Internally contradicted by the doc's own ledger and open item 1. Landed upstream after signing. |
| D4 | Remediation-plan object dropped; owner/start/Copy-as-ticket shipped | **Does not hold.** S5 unmerged (B1). The *reasoning* is consistent with the registry; the shipped-state claim is false. |
| D5 | Twelve thresholds → one dial | **Holds.** `SENSITIVITY_THRESHOLDS`, three positions (`sensitivity.ts:33`); limits displayed; migration maps to nearest and notices once (`store/normalize.ts:37-50`); settled in `DECISIONS.md` §5. |
| D6 | Savings gate 0 → 250 ms | **Holds.** `minimumSavingsMs: 250` with the "deliberately not 0" rationale (`sensitivity.ts:70-75`); no position resolves to 0. Whether the PR flagged it as a behaviour change: unverifiable here (no PR bodies, no changelog in repo). |
| D7 | Digest sends on quiet days | **Holds.** `processDailyDigests` has no empty-suppression branch (`dailyDigest.ts:189-217`); quiet subject is "nothing needs you" (`digest-copy.ts:34,46`). But see R1: an inert Weekly switch shipped beside it, unmentioned. |
| D8 | Partial acceptance with per-page exclusion + reason | **Holds.** `excludedPages: Record<string, ExclusionReason>` (`issue-case.ts:182`), reason required in the decision record (`case-decisions.ts:83`), persisted by F5; checkpoints count included pages and say so (`checkpoint-evaluation.ts:52`, `case-copy.ts:32,109`). |
| D9 | One agent verdict, subline names the failing half | **Holds.** Single `agent_verdict` concept; "One verdict, one subline, five readings" (`agent-access.ts:384`); no second verdict anywhere. |
| D10 | Watchlist near-deletion reversed; shipped additive | **Holds for the shipped state.** C2 (#92) is one small commit adding tier headings; `MAX_ACTIVE_PAGES = 10`, `MAX_PRIORITY_PAGES = 3`, Paused tier, manual order all intact (`watchCapacity.ts:3-4`, `watchlistOrder.ts`). The near-deletion draft itself is in chunk docs I cannot read. |
| D11 | Lifecycle, 2/7/30, source trust not configurable | **Holds.** `CHECKPOINT_DAYS` is a constant (`issue-case.ts:484`); no setting reaches it; sources can be excluded with reason, never weighted; no weighting control exists. |

The divergences' stated reasons check out against the registry and
`DECISIONS.md` wherever the code shipped. I found **no** divergence whose
stated reason is demonstrably a rationalisation. The failures are of
bookkeeping (D3, D4), not of candour about motive.

## Section 07 — verdict on each open item

| # | Marked | Verdict |
|---|---|---|
| 1 | Do first | **True in substance, overstated in detail** (U2): S9 unbuilt at sha; Guide already unreachable dead code; 70 terms, not 63. Landed upstream after signing. |
| 2 | Do first | **False as stated** (B3): the second vocabulary did not render anywhere; `ExternalAgentAuditPanel` unmounted. F6 landed upstream anyway. |
| 3 | **UNVERIFIED** | **Resolves clean.** The repair landed before the document's date: `d00940c` via PR #91, `REPAIRS.md` row moved to Landed, `DECISIONS.md` carries no markers (grep clean). A marked-unverified claim that turned out fine. |
| 4 | Next | **True at sha.** The disclosure's clearest statement was a comment; no user-facing home. C3 landed upstream after. |
| 5 | Next | **True at sha.** Consent one boolean, no record (`types.ts:885`, `mutations.ts:306`). C3 landed upstream after. |
| 6 | **UNVERIFIED** | **Still unverifiable, consistent with the tree.** Handler and `aria-pressed` wiring present (`watchlist/page.tsx:87,292,322`), order tests pass; the manual browser check has still not been done, including by this review (no DOM environment, deliberately). |
| 7 | Unowned | **False** (B4): both sites fixed by S6 on 25 Aug, with tests. |
| 8 | Watch | **True.** `Rec.taskStatus` persisted, `fromRec` derives, exit condition documented (`issue-case.ts:5,13,644,653`). |
| 9 | **UNVERIFIED** | **Resolves to not done.** P32–P34 were *not* closed: mirror comments intact (`charting.ts:11`, `agentAuditServer.ts:8`, `scoreCard.ts:259`), no binding tests; R1's report carried them as "not reached", S6/S4 shipped without touching them. The marked doubt was justified. |
| 10 | Next | **The leftover is real; the premise is wrong.** `addAgentIssueTask`/`promoteAgentIssueToTask` survive — but not "after S5 deleted the task route", because S5 never merged (B1). |
| 11 | Watch | **True.** No jsdom; asserted properties are data (registry-derived tests throughout). |
| 12 | Watch | **True, trivially** — the whole of D4 is unshipped, so its consequence is too. |

## Section 08 "check these first" — results

- **One lifecycle field** — ✓. One `state` on the case; `taskStatusOf`/
  `recStatusOf` are derived read-only views; `Rec.taskStatus` survives exactly
  as open item 8 says. (But the case also still carries `checklist`, which only
  S5 removes — see B1.)
- **No banned word / near-empty allowlist** — ✗. Lint passes, but three
  entries, not one (B2).
- **No summed impact** — ✓. No `reduce`/`+=` over impact figures in `src/`;
  aggregation is `Math.max` (`issue-case.ts:1104-1105,1275`).
- **No fabricated reading** — ✓, better than claimed: zero sites, not two (B4).
- **One result vocabulary** — the claimed defect was not user-visible (B3).
- **The consent gate** — ✓. The gate lives in `collector-worker/oraRefresh.ts:213`
  (the app route relays intent only), and `agent-audit-isolation.test.ts:129-137`
  asserts the *ordering* by index — a property test, as claimed.

On the kind-of-test question the reconciliation's strength rests on: the
enforcement is genuinely property-shaped where it matters. The lint rule reads
`banned_global.terms` and the allowlist from the registry at lint time
(`eslint-rules/no-banned-vocabulary.mjs:23,29`); lifecycle tests parse
`vocabulary.json` and assert transitions against it (`issue-case.test.ts`);
disagreement-means-unclear is asserted including the three-against-one shape
(`issue-case.test.ts:278-291`). One claim I found resting on convention alone:
"Two header patterns exist in the app; a third is a defect" — the shared
component exists (`object-detail-header.tsx`), but nothing mechanical fails on
a third pattern.

## What I could not check, and why

- **The chunk documents** (`Chunk *.dc.html`) live in the design project, not
  the repo. Every claim about rejected options (5c, 6c, 9c), S9's "eight locked
  rewrites", the F6/C3 amendments of 26 August, and per-chunk dependency
  declarations is unverifiable here. Per the brief they are evidence of intent
  only; nothing above cites them.
- **PR bodies and labels** — no GitHub access from this review. D6's "flagged
  in the PR as a behaviour change" and whether the flag "survived into the
  changelog" (no changelog exists in the repo) are unverified.
- **Manual keyboard/browser behaviour** (open item 6) — deliberately no DOM
  environment in this repo; I did not run a browser either.
- **"Main broke four times in three days"** — three breakages are evidenced
  (`728eb6c` red, `96964f9` red, the `aeeca8b` conflict markers, per
  `REPAIRS.md` and CI history); a fourth is asserted by `AGENTS.md` and the
  reconciliation but not independently confirmable from the history alone.
- **The audit's Figma visual companion** — external link, not fetched.

## The one-line summary

The programme's *design* discipline is real and verifiable — the registry, the
derivation-shaped tests, and ten of eleven divergences all check out. The
programme's *reporting* discipline failed exactly where the reconciliation
warned it kept failing: stale premises carried forward. Its most material
claim — what is merged — is wrong by one chunk, and that chunk is the one whose
loss the document itself predicted would be felt most.
