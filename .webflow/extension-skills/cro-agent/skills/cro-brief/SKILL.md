---
name: cro-brief
description: Stage 3 of the CRO loop. Turn the research + action plan into a human-readable CRO briefing that a person reviews before anything ships. Stops at the approval gate. Triggers on "write the briefing", "brief", "CRO recommendation".
---

# CRO Brief (stage 3, stops at the approval gate)

Write the briefing a human reviews. Nothing ships in this POC: there is no execute step.

## Inputs

Read `research.md` and `action-plan.md` for the session. `research.md` comes from
`cro-research` (stage 1) and `action-plan.md` from `cro-reason` (stage 2).

There is no sample data and no fallback site. If either input is missing, you have nothing to
brief, and you MUST NOT invent one. A briefing that reads as real analysis but is not is worse
than no briefing at all: someone will act on it. Follow "Missing inputs" below instead.

## Steps

1. Read `research.md` and `action-plan.md` for the session. If either is missing or empty, go
   to "Missing inputs" and stop.
2. Write `briefing.md`:
   - **Site snapshot:** current state and the conversion problem, in 3-5 sentences.
   - **Proposed experiments:** for each, the change, the evidence (tactic + tier + base rate +
     caveat), why it fits this site, and the success metric.
   - **How it would ship (prose only):** describe the change a human would make (e.g. via the
     Optimize visual editor). Do NOT call any connector; this POC does not execute.
   - **What we would measure and roughly how long.**
3. End the file with a clear gate line:
   `## AWAITING HUMAN APPROVAL - nothing will ship until a person approves this briefing.`

## Missing inputs

Say it in BOTH places. The chat message is what the person reads now; the file header is what
survives after the chat scrolls away.

1. In chat, before writing anything, state plainly that you cannot produce a briefing, name
   each input that is missing, and name the stage that produces it (`cro-research` writes
   `research.md`; `cro-reason` writes `action-plan.md`). Do not describe the site, do not
   suggest tactics, and do not speculate about what the briefing would have said.
2. Write `briefing.md` as a structure-only placeholder that cannot be mistaken for analysis.
   Start it with this line, verbatim:
   `> **NOT A BRIEFING. NO DATA.** The CRO loop did not run, so nothing here describes any real site. This file shows the expected structure only. Every value below is a placeholder.`
   Then reproduce the section headings from step 2 with `⟨missing: …⟩` markers in place of
   content, naming the input each section would have come from. End with the same gate line.
   Never fill a placeholder with a plausible-sounding example.

## Rules

- Readable by a marketer, not just an engineer.
- Every recommendation traces to the action plan and its evidence. No new unsupported ideas,
  no tactics from general best practice, no invented base rates or control strings.
- Keep the briefing high-level. Do not expand the per-idea `Build spec` blocks from action-plan.md;
  point builders to action-plan.md for the buildable control / arm / target / goal detail.
- Do not execute, do not call connectors, do not write to the site.
