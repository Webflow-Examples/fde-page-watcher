#!/usr/bin/env node
// CRO variation-idea lookup: given a new page's context, return ranked, evidence-graded ideas.
//
// Node port of lookup_variations.py (full parity target: structured filter + first-party history
// + peer benchmark + semantic neighbours + text/JSON render). It is dependency-free for the
// structured and offline-semantic (--like-page-id) paths. Only --query-text needs an embedding
// call, via a lazy import of @aws-sdk/client-bedrock-runtime (an optional dependency; already
// used elsewhere in this repo by the Pi adapter). Without it, semantic search degrades with a
// warning, exactly like the Python tool did when boto3/creds were absent.
//
// It is deliberately a retrieval/triage tool, NOT a winner-predictor. Every card states its
// evidence class and caveat.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Vendored from webflow/cro-agent's idea-library/{tools,data}; this skill flattens that
// two-directory layout to script + data/ siblings, one level shallower than upstream.
const DATA = path.join(HERE, "data");
const LEDGER = path.join(DATA, "variation_library.jsonl");
const EMB = path.join(DATA, "variation_library_emb.jsonl");
const CATALOG = path.join(DATA, "tactic-catalog.jsonl");
const EMB_MODEL = "amazon.titan-embed-text-v2:0";

const PATH_INTENT = [
  ["high", /quote|estimate|\/apply|application|career|\/jobs|\/demo|trial|get-?started|book|schedule|appointment|checkout|\/buy|\/order|\/enroll|consultation|request-a|contact-sales|get-a-quote|reserv/],
  ["contact", /contact|kontakt|get-in-touch|reach-us|\/message|\/support|enquir|inquir/],
  ["account", /sign-?up|\/register|\/signup|\/join|create-account|\/account|\/login|log-in/],
  ["low", /subscribe|newsletter|waitlist|\/updates|\/blog|\/news|\/article|\/resource|\/guide|download/],
];

const round3 = (x) => Math.round(x * 1000) / 1000;

function intentFromUrl(url) {
  const p = (url || "").toLowerCase().replace(/^https?:\/\/[^/]+/, "") || "/";
  for (const [name, rx] of PATH_INTENT) if (rx.test(p)) return name;
  return p === "/" || p === "" ? "home" : "other";
}

function loadJsonl(fp) {
  return fs.readFileSync(fp, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function sliceFor(tactic, key, value) {
  if (!value) return null;
  const arr = (tactic.by_context || {})[key] || [];
  for (const sl of arr) if (String(sl.value).toLowerCase() === String(value).toLowerCase()) return sl;
  return null;
}

function cosineKnn(qvec, embRows, k) {
  let qn = 0;
  for (const x of qvec) qn += x * x;
  qn = Math.sqrt(qn) || 1.0;
  const sims = new Array(embRows.length);
  for (let i = 0; i < embRows.length; i++) {
    const e = embRows[i].emb;
    let dot = 0, en = 0;
    for (let j = 0; j < e.length; j++) { dot += e[j] * qvec[j]; en += e[j] * e[j]; }
    en = Math.sqrt(en) + 1e-9;
    sims[i] = [embRows[i].key, dot / (qn * en)];
  }
  sims.sort((a, b) => b[1] - a[1]);
  return sims.slice(0, k);
}

async function embedQuery(text) {
  // Embed a free-text page description via Bedrock (needs the optional AWS SDK + creds).
  // Returns null (with a warning) if unavailable, matching the Python tool's fallback.
  try {
    const mod = await import("@aws-sdk/client-bedrock-runtime");
    const client = new mod.BedrockRuntimeClient({ region: "us-east-1" });
    const body = JSON.stringify({ inputText: text, dimensions: 256, normalize: true });
    const resp = await client.send(new mod.InvokeModelCommand({ modelId: EMB_MODEL, body }));
    return JSON.parse(new TextDecoder().decode(resp.body)).embedding;
  } catch (e) {
    process.stderr.write(
      `[warn] could not embed query via Bedrock (${(e && e.name) || "error"}); ` +
        "skipping semantic search. Pass --like-page-id for an offline semantic query.\n",
    );
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    goal: "both", intent: null, vertical: null, traffic_band: null, url: null, tactic: null,
    query_text: null, like_page_id: null, k: 6, json: false, site_id: null, customer_id: null,
  };
  const map = {
    "--goal": "goal", "--intent": "intent", "--vertical": "vertical", "--traffic-band": "traffic_band",
    "--url": "url", "--tactic": "tactic", "--query-text": "query_text", "--like-page-id": "like_page_id",
    "--k": "k", "--site-id": "site_id", "--customer-id": "customer_id",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { args.json = true; continue; }
    if (a in map) {
      const key = map[a];
      let v = argv[++i];
      if (key === "k") v = parseInt(v, 10);
      args[key] = v;
      continue;
    }
    throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.url && !args.intent) args.intent = intentFromUrl(args.url);

  const catalog = loadJsonl(CATALOG);
  const ledger = loadJsonl(LEDGER);
  const byKey = {};
  for (const r of ledger) {
    if (r.record_kind === "ab-variation") byKey[`${r.experiment_id}|${r.treat_vid}`] = r;
    else byKey[r.page_id] = r;
  }

  // First-party history: this site's/customer's own prior experiments.
  let firstParty = [];
  if (args.site_id || args.customer_id) {
    for (const r of ledger) {
      if (r.record_kind !== "ab-variation") continue;
      if (
        (args.site_id && r.site_id === args.site_id) ||
        (args.customer_id && String(r.customer_id) === String(args.customer_id))
      ) {
        firstParty.push({
          experiment_id: r.experiment_id ?? null, name: r.experience_name ?? null,
          tactic: (r.recovered_tactic_labels || r.tactic_labels) ?? null,
          provenance: r.content_origin ?? null,
          change: (r.change_summary || r.text_summary || r.css_summary) ?? null,
          effect_pp: r.effect_pp ?? null, significant: r.significant ?? null,
          direction: r.direction ?? null, powered: r.powered ?? null, page_intent: r.page_intent ?? null,
        });
      }
    }
    firstParty.sort((a, b) => {
      const as = a.significant ? 0 : 1;
      const bs = b.significant ? 0 : 1;
      if (as !== bs) return as - bs;
      return Math.abs(b.effect_pp || 0) - Math.abs(a.effect_pp || 0);
    });
  }

  const goalClasses = {
    "beacon-goal": ["randomized-ab"],
    "form-lead": ["observational-benchmark"],
    both: ["randomized-ab", "observational-benchmark"],
  }[args.goal];

  // 1) rank tactic ideas
  const tierRank = { A: 0, B: 1, C: 2, D: 3 };
  const cards = [];
  for (const t of catalog) {
    if (!goalClasses.includes(t.evidence_class)) continue;
    if (args.tactic && t.tactic_id !== args.tactic) continue;
    const ctxSlice =
      sliceFor(t, "page_intent", args.intent) ||
      sliceFor(t, "site_vertical", args.vertical) ||
      sliceFor(t, "traffic_band", args.traffic_band);
    let card;
    if (t.evidence_class === "randomized-ab") {
      const base = ctxSlice || t;
      card = {
        tactic: t.tactic_id, tier: t.confidence_tier, evidence_class: t.evidence_class,
        description: t.description, label_basis: t.label_basis ?? null, provenance: t.provenance ?? null,
        context: ctxSlice ? ctxSlice.value : "all",
        pct_up_excl_flat: base.pct_up_excl_flat ?? null, n_powered: base.n_powered ?? null,
        n_customers: (base.n_customers || t.n_customers) ?? null,
        median_effect_pp: (base.effect_pp || {}).median ?? null,
        sig_up_down: `${base.n_sig_up}/${base.n_sig_down}`,
        caveats: t.caveats,
      };
    } else {
      const base = ctxSlice || t;
      card = {
        tactic: t.tactic_id, tier: t.confidence_tier, evidence_class: t.evidence_class,
        description: t.description, context: ctxSlice ? ctxSlice.value : "all",
        pct_over_peers: base.pct_over_peers ?? null, median_form_cr: base.form_cr_median ?? null,
        n_powered: base.n_powered ?? null, feature_breakdown: t.feature_breakdown ?? null,
        moderators: t.moderators ?? null, caveats: t.caveats,
      };
    }
    cards.push([tierRank[t.confidence_tier] ?? 9, card]);
  }
  cards.sort((a, b) => a[0] - b[0] || (b[1].n_powered || 0) - (a[1].n_powered || 0));
  const ideas = cards.map((c) => c[1]);

  // 2) peer benchmark (form-lead)
  let benchmark = null;
  if (args.goal === "form-lead" || args.goal === "both") {
    const fp = catalog.find((t) => t.tactic_id === "form-placement");
    if (fp) {
      const sl = sliceFor(fp, "page_intent", args.intent);
      benchmark = {
        context: args.intent || "all",
        typical_form_cr: (sl || fp).form_cr_median ?? null,
        n_pages: (sl || fp).n_powered ?? null,
        note: "Typical (median) form-CR for comparable pages; observational peer benchmark.",
      };
    }
  }

  // 3) similar prior cases (semantic kNN)
  let similar = [];
  let qvec = null;
  if (args.like_page_id || args.query_text) {
    let embRows = [];
    if (fs.existsSync(EMB)) embRows = loadJsonl(EMB).filter((r) => goalClasses.includes(r.evidence_class));
    if (args.like_page_id) {
      const hit = embRows.find((r) => r.key === args.like_page_id);
      qvec = hit ? hit.emb : null;
      if (qvec === null) process.stderr.write(`[warn] --like-page-id ${args.like_page_id} not found in embeddings.\n`);
    } else if (args.query_text) {
      qvec = await embedQuery(args.query_text);
    }
    if (qvec !== null && embRows.length) {
      for (const [key, sim] of cosineKnn(qvec, embRows, args.k + 1)) {
        if (key === args.like_page_id) continue;
        const r = byKey[key];
        if (!r) continue;
        if (r.record_kind === "ab-variation") {
          similar.push({
            sim: round3(sim), kind: "ab-variation",
            experiment_id: r.experiment_id, name: r.experience_name ?? null,
            tactic: (r.recovered_tactic_labels || r.tactic_labels) ?? null,
            provenance: r.content_origin ?? null,
            change: (r.change_summary || r.text_summary || r.css_summary) ?? null,
            effect_pp: r.effect_pp ?? null, significant: r.significant ?? null, direction: r.direction ?? null,
          });
        } else {
          similar.push({
            sim: round3(sim), kind: "page-benchmark", traffic_band: r.traffic_band ?? null, intent: r.page_intent ?? null,
            form_cr: r.form_cr ?? null, over_peers: r.over_peers ?? null,
            above_fold: r.above_fold ?? null, field_count: r.field_count ?? null,
          });
        }
      }
      similar = similar.slice(0, args.k);
    }
  }

  const query = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "json") continue;
    if (v) query[k] = v; // matches Python `if v`
  }

  const result = { query, first_party: firstParty, ideas, peer_benchmark: benchmark, similar_cases: similar };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 1) + "\n");
    return;
  }
  renderText(result);
}

function renderText(res) {
  const q = res.query;
  const out = [];
  out.push("=".repeat(78));
  out.push("CRO VARIATION-IDEA LOOKUP  -  evidence-graded ideas, NOT guaranteed lifts");
  out.push("context: " + (Object.entries(q).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"));
  out.push("=".repeat(78));
  if (res.first_party && res.first_party.length) {
    out.push(
      "\nFIRST-PARTY HISTORY | this site's/customer's OWN prior experiments " +
        "(highest-confidence anchor; additive to the pooled ideas below):",
    );
    for (const c of res.first_party) {
      const eff = c.effect_pp;
      const effs = typeof eff === "number" ? `${eff >= 0 ? "+" : ""}${eff.toFixed(2)}pp` : "n/a";
      const sig = c.significant ? "SIG" : "ns";
      const tac = (c.tactic || []).join(", ") || "tactic?";
      out.push(`\n  [${c.provenance}] '${c.name}'  (${tac})`);
      out.push(`       ${sig} ${c.direction} ${effs}  ·  intent=${c.page_intent}  ·  powered=${c.powered}`);
      if (c.change) out.push(`       change: ${String(c.change).slice(0, 150)}`);
    }
    out.push("\n  -> Replicate this site's own significant WINS; avoid repeating its LOSSES.");
  }
  if (res.peer_benchmark && res.peer_benchmark.typical_form_cr != null) {
    const b = res.peer_benchmark;
    out.push(
      `\nPEER BENCHMARK - typical form-CR for ${b.context} pages: ` +
        `${b.typical_form_cr.toFixed(3)} (median over ${b.n_pages} pages). ` +
        "Compare the new page's CR to gauge headroom.",
    );
  }
  out.push("\nTACTIC IDEAS (ranked by evidence tier):");
  for (const c of res.ideas) {
    if (c.evidence_class === "randomized-ab") {
      const tag =
        c.label_basis === "name-inferred"
          ? "  (name-inferred theme; change content unknown)"
          : c.label_basis === "snapshot-recovered"
            ? "  (RECOVERED real change content - before/after in .artifacts)"
            : "";
      out.push(`\n  [${c.tier}] ${c.tactic}${tag}  -  ${c.description}`);
      out.push(
        `       base rate (${c.context}): ${c.pct_up_excl_flat}% up (excl. flat) ` +
          `over ${c.n_powered} powered variations / ${c.n_customers} customers; ` +
          `median ${c.median_effect_pp}pp; significant up/down ${c.sig_up_down}.`,
      );
    } else {
      out.push(`\n  [${c.tier}] ${c.tactic}  -  ${c.description}`);
      out.push(
        `       ${c.pct_over_peers}% of ${c.context} pages beat peer-expected CR; ` +
          `median form-CR ${c.median_form_cr}.`,
      );
      for (const fb of (c.feature_breakdown || []).slice(0, 4)) {
        out.push(
          `         · ${fb.value}: ${fb.pct_over_peers}% over peers (n=${fb.n_powered}), ` +
            `median CR ${fb.form_cr_median}`,
        );
      }
      for (const m of c.moderators || []) out.push(`         moderator: ${m}`);
    }
    out.push(`       [!]  ${c.caveats[0]}`);
  }
  if (res.similar_cases && res.similar_cases.length) {
    out.push("\nSIMILAR PRIOR CASES (semantic):");
    for (const s of res.similar_cases) {
      if (s.kind === "ab-variation") {
        out.push(
          `  ~${s.sim} exp ${s.experiment_id} "${(s.name || "").slice(0, 50)}" ` +
            `[${(s.tactic || []).join(",")}] d${s.effect_pp}pp ` +
            `${s.significant ? "SIG" : "ns"} ${s.direction}` +
            (s.change ? ` - ${String(s.change).slice(0, 60)}` : ""),
        );
      } else {
        const cr = typeof s.form_cr === "number" ? s.form_cr.toFixed(3) : s.form_cr;
        out.push(
          `  ~${s.sim} traffic=${s.traffic_band ?? "?"} intent=${s.intent} ` +
            `CR=${cr} ${s.over_peers ? "OVER" : "under"}-peers ` +
            `above_fold=${s.above_fold} fields=${s.field_count}`,
        );
      }
    }
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

main().catch((e) => {
  process.stderr.write(String((e && e.stack) || e) + "\n");
  process.exit(1);
});
