# CRO Reason (stage 2)

Referenced by `cro-analyze/SKILL.md`. Not a standalone skill — see PION-680 Decisions on keeping
the skill picker to `cro-brief`, `cro-variation-lookup`, and `cro-analyze` only.

Turn `research.md`'s evidence into a prioritized, grounded `action-plan.md`. Ideas MUST come from
the variation library via the `cro-variation-lookup` skill, never invented winners.

## Steps

1. Read `research.md` for the session and extract, per opportunity page: the inferred `goal`
   (`beacon-goal` or `form-lead`) with whatever evidence tier it carries
   (`[LIVE]`/`[INSPECTED]`/`[USER-STATED]`), `page_intent`, site `vertical`, and `traffic_band` if
   present. `goal` is required to run the lookup at all; if `research.md` marks it
   `[UNAVAILABLE]`, stop and report per `cro-analyze`'s rules rather than guessing one yourself.
2. Activate the `cro-variation-lookup` skill (its framing on confidence tiers, provenance, and
   "typology not winner-predictor" governs how you use its output) and run it once per distinct
   (intent, band) opportunity:
   ```
   node .webflow/extension-skills/cro-agent/skills/cro-variation-lookup/lookup_variations.mjs \
       --goal <goal> --intent <intent> --vertical "<vertical>" \
       [--traffic-band <band>] [--site-id <site_id> | --customer-id <customer_id>] --json
   ```
   Only pass `--traffic-band` when `research.md` marks it `[LIVE]`; omit it entirely when
   `research.md` marks it `[UNAVAILABLE]` rather than guessing a band — the tool still returns a
   peer benchmark and tactic ideas without it, just not traffic-sliced. Pass `--site-id` or
   `--customer-id` only when `research.md` actually recorded one; omit both when neither is known
   rather than inventing a placeholder — the first-party-history block is simply empty in that
   case, which is honest, not an error. Ignore the Bedrock semantic-search warning; the structured
   filter path is offline and sufficient.
3. Select 2-4 tactics that (a) match the site's actual weaknesses from `research.md` — citing the
   specific behavioral signal by name when the evidence is `[LIVE]`, or the specific structural/
   inspected signal (copy, CTA, form shape) when it's `[INSPECTED]`/`[USER-STATED]` — and (b)
   carry the strongest evidence tier available. Prefer tier A/B; treat D (observational) as
   exploratory only.
4. Capture ground truth for each selected idea from `research.md`: the exact control copy string,
   the target element/section, and the tracked goal event. If `research.md` did not record a
   control string, mark it `⟨capture control string⟩` — never invent one.
5. Write `action-plan.md`. Open with a **Controls & goal events (verbatim)** preamble, then for
   each idea write reviewer prose AND a build-ready spec:
   - **Target / Change / Evidence / Success metric** — reviewer-facing prose. Evidence is tactic +
     tier + sliced base rate + caveat; present as a hypothesis with a base rate, never "this will
     lift conversion by X%".
   - **### Build spec:** `Hypothesis`, `Target`, `Control` (exact string or `⟨capture control
     string⟩`), `Arm V1/V2` (exact treatment strings, one tactic per arm, each with a short "why"),
     `Goal event` (verbatim), `Design + decision` (arm split, one-line powering verdict, read-out
     rule: ship highest-CR arm if p<0.05 vs Control, hold >=14 days), `Evidence (backtracking)`
     (library tactic + tier + base rate + caveat, plus the first-party `research.md` signal),
     `Guardrail` (inline `⟨claim: verify accuracy/legal⟩` on any new factual claim).
6. Order by expected value given evidence and effort. Keep the idea count small (top ~4).

## Rules

- Every idea cites a library tactic + tier + caveat via `cro-variation-lookup`. No unsupported
  ideas, no invented control strings.
- Respect the library's framing: a typology for idea generation, not a winner-predictor.
- Carry `research.md`'s evidence tiers (`[LIVE]`/`[INSPECTED]`/`[USER-STATED]`/`[UNAVAILABLE]`)
  forward into `action-plan.md`'s own evidence lines, so a reviewer can see how much of each idea
  rests on real usage data versus structural inference versus a stated answer — do not let a
  `[LIVE]`-grounded library tactic and an `[INSPECTED]`-grounded site signal read as the same
  strength of evidence.
- If the site's Optimize collection is off (per `research.md`), stay in the form-lead corpus; do
  not cite beacon-goal (A/B) evidence.
- If a stage's required input is missing or empty, stop and report per `cro-analyze`'s rules; do
  not proceed on a placeholder.
