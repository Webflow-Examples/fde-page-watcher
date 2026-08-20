---
name: cro-variation-lookup
description: Use when a CRO agent needs to propose or assess page-variation ideas for a new page — given its intent (home/contact/high-action/etc.), site vertical, conversion goal (form-lead vs beacon-goal), traffic band, or a page description. Looks up what variations were actually tried on comparable Webflow Optimize pages and how they performed, as evidence-graded ideas. Triggers on "what should I test on this page", "variation ideas", "CRO recommendations", "is this conversion rate good", "what has worked for <page type>".
---

# CRO Variation-Idea Lookup

Retrieval over the **variation library** — an evidence-graded record of ~2,100 randomized
Webflow Optimize A/B contrasts and ~2,100 observational form-CR page benchmarks. Use it to
ground variation suggestions in *what was actually tried and observed*, not generic CRO priors.

## Hard framing — read before you answer

This library is a **typology for idea-generation, NOT a winner-predictor.** The research
program proved that a-priori prediction of *which variation wins* is **NO-GO** across every
representation, and the one observational signal (form placement) is **~0 causally** once
confounders are adjusted. So:

- Present each idea as a **hypothesis with a base rate**, never "this will lift conversion by X%".
- Always surface the **confidence tier** and the **caveat** the tool returns.
- Never conflate the two goals: **beacon-goal** conversions (A/B corpus) and **form-lead**
  submissions (observational corpus) *decouple* — pick the one matching the user's actual goal.
- Effects are small and heterogeneous (1–5% typical). Set expectations accordingly.

## How to run

```
node .webflow/extension-skills/cro-agent/skills/cro-variation-lookup/lookup_variations.mjs \
    --goal {form-lead|beacon-goal|both} \
    [--intent home|contact|high|account|low|other] \
    [--url https://…]            # infers intent from the path \
    [--vertical "B2B SaaS/Software"] \
    [--traffic-band <1k|1k-10k|10k-100k|100k+] \
    [--tactic cta-copy]          # focus one tactic \
    [--query-text "landing page for a dental clinic booking form"]  # semantic (needs Bedrock) \
    [--like-page-id <page_id>]   # semantic, offline (uses a stored embedding) \
    [--site-id <site_id>]        # first-party: THIS site's own prior experiments \
    [--customer-id <customer_id>]  # first-party by Optimize customer id \
    [--json]
```

It returns three blocks: **peer benchmark** (typical form-CR for this kind of page → headroom),
**tactic ideas** (ranked by evidence tier, base rate sliced to the requested context), and
**similar prior cases** (semantic neighbours — real experiments with copy/CSS diffs, or
comparable pages with measured CR).

This slice vendors only the structured-filter data (`data/tactic-catalog.jsonl` +
`data/variation_library.jsonl`). The embeddings file `--like-page-id` needs is not vendored
here (idea-library storage/access is a separate, longer-term effort — see PION-680), and
`--query-text` needs Bedrock credentials this environment does not provide. Both degrade
gracefully — empty `similar_cases` plus a stderr warning, never a failure — so structured
filtering, first-party history, and the peer benchmark are always fully populated.

Some tactic ideas are marked `<tactic>~named` and *"name-inferred theme; change content unknown"*.
These come from the ~64% of A/B rows whose DOM change is unrecoverable but whose experiment **name**
reveals the theme; they are always **tier C** — treat them as idea prompts + a base rate, not a
parsed change. Present them as *"tests themed X have been run; here's the base rate,"* never as a
specific known edit.

Pass `--site-id <site_id>` (the site under analysis) or `--customer-id <id>` (the Optimize customer id
`cro-research` finds in page-context) to add a **FIRST-PARTY HISTORY** block: that site's OWN prior
experiments. A site's own significant result is the strongest anchor there is (replicate its wins, avoid
its losses). It is additive to the pooled cross-customer ideas, and works even when live Optimize
collection is off. Always pass it when you know the site.

## Confidence tiers

`A` randomized + replicated (≥8 customers, ≥50 powered, ≥5 significant) with a directional lean
(up **or** down) · `B` randomized, moderate volume · `C` randomized but thin · `D` observational
(association only) or `webflow-opaque` (change content unknown, base-rate prior only).

Tier reflects **how reliable the base rate is, not how likely the tactic is to win.**

## Provenance (opaque vs non-opaque)

Each idea is tagged with where its change content came from — ledger `content_origin`, catalog
`provenance`, and a `--json` `provenance` field:
- `non-opaque-declarative` — change parsed from real declarative content (bare tactic ids).
- `opaque-recovered` — was webflow-opaque; actual DOM/CSS **recovered from a SiteSnapshot** (`~recovered`
  tactics; before/after in the row's `change_summary`).
- `opaque-name-inferred` — tactic **guessed from the experiment name** only (`~named`; weakest — a proxy).
- `opaque-unknown` — no content or name signal; base-rate prior only (`webflow-opaque`).

Prefer `non-opaque-declarative` and `opaque-recovered` (real change content) when proposing concrete
ideas; treat `opaque-name-inferred` as a theme hint, not a known change.
