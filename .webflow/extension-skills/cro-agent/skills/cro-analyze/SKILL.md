---
name: cro-analyze
description: Run the full CRO diagnose-then-insights loop (research -> reason -> briefing) end to end and produce a human-reviewed CRO briefing. Triggers on "run CRO analysis", "analyze this site for conversion", "CRO briefing", "diagnose conversion issues".
---

# CRO Analyze (orchestrator: research -> reason -> brief)

Run the three CRO stages in order and produce a briefing. Stop at the human-approval gate; this
POC never executes changes.

This skill packages `cro-research` and `cro-reason` as reference docs in its own directory
(`cro-research.md`, `cro-reason.md`) rather than as separately triggerable skills, to keep the
skill picker uncluttered. `cro-brief` and `cro-variation-lookup` stay separately registered
because a person can usefully ask for either on its own (see PION-680 Decisions). Read each
referenced doc in full and follow its instructions; do not skip a stage or summarize it from
memory.

## Steps

1. Read `./cro-research.md` (in this skill's own directory) and follow it to produce `research.md`
   in the workspace. Stop and report if it says there is no data to work with; do not proceed to
   reason/brief on a placeholder.
2. Read `./cro-reason.md` and follow it to produce `action-plan.md` from `research.md`.
3. Activate the `cro-brief` skill and follow it to turn `research.md` + `action-plan.md` into
   `briefing.md`.
4. Report the path to `briefing.md` and stop. Do not proceed past the approval gate.

## Rules

- If a stage produces an empty or clearly wrong artifact, stop and report rather than continuing
  (matches `cro-brief`'s and `cro-research`'s own missing-input contracts).
- Never execute changes; this loop ends at the briefing.
- This slice always prefers real evidence: live traffic/analytics when a data capability reaches
  it (none exists in Studio today — deferred framework work, see the PION-680 gap analysis, gap
  G1), otherwise real structural inspection of the open project, otherwise asking the user
  directly for what can't be inspected. Never a fabricated substitute. See `cro-research.md` for
  the evidence-tier contract (`[LIVE]`/`[INSPECTED]`/`[USER-STATED]`/`[UNAVAILABLE]`) that
  `cro-reason` and `cro-brief` must carry through.
