# CRO Research (stage 1, Studio adaptation)

Referenced by `cro-analyze/SKILL.md`. Not a standalone skill — see PION-680 Decisions on keeping
the skill picker to `cro-brief`, `cro-variation-lookup`, and `cro-analyze` only.

Upstream `cro-research` (`webflow/cro-agent`) pulls a site's own evidence live from Snowflake
(CDN traffic, form-leads, page/DOM context) and the Optimize behavioral Druid. Real traffic and
conversion data is the actual product differentiator here — always prefer it over everything
else, and use it fully whenever it is reachable. Do not skip straight to the fallback below just
because it is more work to check for a live source first.

## Evidence priority (check in this order every time; do not shortcut it)

1. **Live analytics/traffic (preferred).** Check whether any host-brokered data capability is
   available to this run that reaches real traffic, form-lead, or Optimize behavioral data (the
   `webflowFetch`-style pattern: the host holds the credential, the agent gets results, no
   Snowflake/Druid access exists for extensions today). As of this writing there is none — Studio
   has no host-brokered capability for Snowflake/Druid/Optimize (PION-680 gap analysis, gap G1);
   the only host-brokered pattern that exists (`webflowFetch`/`ExtensionCloudTransport`) is
   Cloud deploy/authorize only, and the agent's own `bash` is credential-denied by design
   (scrubbed environment) so it can never carry a Snowflake/Optimize credential regardless. Check
   for this capability structurally rather than treating its absence as a fact frozen into this
   file — the moment a real data capability exists, use it, write real numbers, and mark them
   LIVE below. Until then this tier reports UNAVAILABLE; never approximate or invent a number to
   fill the gap.
2. **Real inspection of the open project (fallback, only when tier 1 is unavailable or the
   returned data is empty/too sparse to say anything).** Enumerate the actually open project's
   real pages/routes/components (an ordinary file read, no special capability). For the page(s)
   most likely to be the primary conversion point (home, contact, pricing, a landing page), read
   its real content: headline/CTA copy, forms present (fields, submit button text), and whether
   the codebase includes an Optimize SDK/beacon snippet (evidence of `beacon-goal` tracking) versus
   relying on a plain form submit (`form-lead`). This grounds `page_intent`, `vertical`, and often
   `goal` in real, inspected fact — never invented, but also never as strong as tier 1's real usage
   data.
3. **Ask the user directly (only for what tier 2 genuinely can't determine).** If `goal` cannot be
   determined from the codebase (no Optimize snippet found, and no clear form either, or the
   signal is ambiguous), ask the user which conversion goal matters for this analysis rather than
   guessing. This is not a new mechanism: it is the same fact PR B's live proof already
   demonstrated — a human stating `--goal beacon-goal` directly made the lookup work with zero
   traffic data behind it — just moved one step earlier in the loop instead of relying on the
   human to volunteer it unprompted.
4. **`traffic_band` specifically:** this needs real traffic volume (tier 1). Do not estimate a
   band from file counts, repo size, or any other structural proxy — there is no honest inference
   path from project structure to traffic volume. If tier 1 is unavailable, leave `traffic_band`
   unset; `cro-reason`/`cro-variation-lookup` already treat it as optional and degrade gracefully
   (a peer benchmark plus tactic ideas, just not traffic-sliced).
5. **Never fabricate.** If a section has no real data at any tier (tier 1 unavailable, tier 2
   finds nothing usable — e.g. an empty or unreadable project — and tier 3 doesn't apply or the
   user doesn't know), say so plainly in `research.md` and in chat. This matches `cro-brief`'s own
   "no data, do not invent one" contract.

## Write research.md

Same four sections as upstream, each claim tagged with the evidence tier it actually came from,
so `cro-reason` and `cro-brief` carry the right confidence forward and a reviewer can see exactly
how much of the briefing rests on real usage data versus structural inference versus a stated
answer:

- `[LIVE]` — real traffic/analytics/Optimize data (tier 1).
- `[INSPECTED]` — real signal read from the open project's actual files (tier 2).
- `[USER-STATED]` — the human told the agent directly (tier 3).
- `[UNAVAILABLE]` — no real data at any tier; explicitly say so, do not fill the gap.

Alongside each tag, record the concrete source: the file/route read for `[INSPECTED]`, the
query/capability invoked and when it was observed for `[LIVE]`, or that the human stated it
directly for `[USER-STATED]`. A tier tag alone tells a reviewer how strong a claim is, not where
it came from; the source/freshness note is what lets `cro-reason` and `cro-brief` (and a human
reviewer) audit a claim in `action-plan.md`/`briefing.md` back to the evidence that produced it,
matching the source-citation/authority/freshness expectation in `AGENTS.md`'s knowledge-retrieval
rules.

Sections:

- **Traffic:** volume, human vs bot split, source, top pages by request, with the tier tag.
  Typically `[UNAVAILABLE]` today (no live analytics lane exists yet); write it as unavailable,
  not as a zero or an estimate.
- **Forms / conversion:** which pages carry real conversion forms, lead counts, obvious drop-off
  if tier 1 data exists; otherwise `[INSPECTED]` — which forms exist in the code and what they
  submit, with no volume/lead-count claim attached.
- **Page & DOM context:** the primary conversion page(s), what the page actually is (from its
  real content), DOM/structural shape. Should be `[INSPECTED]` whenever a project is open with
  discoverable pages; only `[UNAVAILABLE]` if the project genuinely has nothing to read.
- **Inferred context:** `goal` (`[LIVE]`/`[INSPECTED]`/`[USER-STATED]` per how it was determined),
  `page_intent`, `vertical` (both `[INSPECTED]` from real content when determinable), and
  `traffic_band` (`[LIVE]` if tier 1 exists, otherwise `[UNAVAILABLE]` — never guessed).

## Rules

- Always check for a live data source first; never hardcode "no data exists" as a permanent
  fact — this stage should automatically start using real traffic/analytics data the moment a
  live capability exists, without needing to be rewritten.
- Never invent traffic, form-lead, or DOM figures for a tier that came back empty or unavailable.
  State the gap plainly instead of approximating.
- Tier-2 inspection must be of the actual open project's real files. Never invent page content,
  copy, or structure that isn't really there.
- If asked to "research my site" and inspection finds nothing usable (an empty or unreadable
  project), say so and stop, matching `cro-brief`'s own "no data, do not fabricate" contract.
