import type { AgentCheck, AppState, CategoryKey, Night, NightScores, PageStatus, Rec, StrategyScores, WatchPage } from "./types";

// Faithful port of the source design's seed generator so the freshly-seeded
// app renders identically to the prototype, then real runs append on top.
// The mobile series matches the prototype byte-for-byte (same LCG, same call
// order); the desktop series is derived deterministically (perf runs ~18 pts
// higher, other categories equal), giving a real per-strategy shape without
// disturbing the mobile sequence.

interface Seed {
  id: string;
  title: string;
  url: string;
  flag: "priority" | "watching";
  base: Record<CategoryKey, number>;
  status: "healthy" | "room" | "dropped";
  marker?: { i: number; text: string };
}

const SEEDS: Seed[] = [
  { id: "home", title: "Homepage", url: "webflow.com", flag: "priority", base: { perf: 74, a11y: 96, bp: 100, seo: 100 }, status: "healthy" },
  { id: "pricing", title: "Pricing", url: "webflow.com/pricing", flag: "priority", base: { perf: 69, a11y: 93, bp: 96, seo: 100 }, status: "dropped", marker: { i: 22, text: "Deployed new hero video" } },
  { id: "designer", title: "Designer", url: "webflow.com/product/designer", flag: "priority", base: { perf: 61, a11y: 91, bp: 92, seo: 92 }, status: "room", marker: { i: 17, text: "Compressed hero imagery" } },
  { id: "enterprise", title: "Enterprise", url: "webflow.com/enterprise", flag: "watching", base: { perf: 82, a11y: 98, bp: 100, seo: 100 }, status: "healthy" },
  { id: "ai", title: "AI", url: "webflow.com/ai", flag: "priority", base: { perf: 64, a11y: 89, bp: 96, seo: 92 }, status: "room" },
  { id: "hosting", title: "Hosting", url: "webflow.com/hosting", flag: "watching", base: { perf: 78, a11y: 95, bp: 100, seo: 100 }, status: "healthy" },
  { id: "templates", title: "Templates", url: "webflow.com/templates", flag: "watching", base: { perf: 56, a11y: 88, bp: 92, seo: 85 }, status: "room" },
];

const CAT_KEYS: CategoryKey[] = ["perf", "a11y", "bp", "seo"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const N = 30;
const DESKTOP_PERF_BONUS = 18;

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

const STATUS_MAP: Record<Seed["status"], PageStatus> = { healthy: "stable", room: "regressing", dropped: "regressing" };

function dateFor(i: number): string {
  const d = new Date(2026, 5, 17);
  d.setDate(d.getDate() + i);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Derive a desktop NightScores from a mobile one: perf ~18 higher, others equal. */
function toDesktop(mobile: NightScores): NightScores {
  const bump = (c: { m: number; lo: number; hi: number }) => ({ m: clamp(c.m + DESKTOP_PERF_BONUS), lo: clamp(c.lo + DESKTOP_PERF_BONUS), hi: clamp(c.hi + DESKTOP_PERF_BONUS) });
  return { perf: bump(mobile.perf), a11y: { ...mobile.a11y }, bp: { ...mobile.bp }, seo: { ...mobile.seo } };
}

// Agent-readiness definitions (per-check, grouped) — matches the design.
const AGENT_GROUPS: { name: string; items: string[] }[] = [
  { name: "Discoverability", items: ["robots.txt", "Sitemap", "Link headers", "DNS for AI Discovery (DNS-AID)"] },
  { name: "Content Accessibility", items: ["Markdown negotiation"] },
  { name: "Bot Access Control", items: ["AI bot rules", "Content Signals", "Web Bot Auth"] },
  { name: "API / Auth / MCP", items: ["API Catalog", "OAuth discovery", "OAuth Protected Resource", "Auth.md", "MCP Server Card", "A2A Agent Card", "Agent Skills", "WebMCP"] },
  { name: "Commerce", items: ["x402", "MPP", "UCP", "ACP"] },
];
const AGENT_FAILS: Record<string, string[]> = {
  pricing: ["Markdown negotiation", "WebMCP", "DNS for AI Discovery (DNS-AID)"],
  designer: ["WebMCP", "ACP", "Web Bot Auth"],
  ai: ["UCP", "ACP"],
  templates: ["Markdown negotiation", "A2A Agent Card", "WebMCP", "MCP Server Card", "x402", "MPP"],
  home: ["WebMCP"],
  enterprise: [],
  hosting: ["ACP"],
};
const AGENT_REGRESSED: Record<string, string[]> = {
  pricing: ["Markdown negotiation"],
  designer: ["Web Bot Auth"],
};

function agentFor(id: string): AgentCheck[] {
  const fails = AGENT_FAILS[id] || [];
  const regs = AGENT_REGRESSED[id] || [];
  const out: AgentCheck[] = [];
  for (const g of AGENT_GROUPS) {
    for (const name of g.items) {
      out.push({ name, group: g.name, pass: !fails.includes(name), regressed: regs.includes(name) });
    }
  }
  return out;
}

const REC_DEFS = [
  { id: "r1", title: "Reduce unused JavaScript", category: "Performance", savings: "1.8 s", estTime: "2 days" },
  { id: "r2", title: "Serve images in next-gen formats", category: "Performance", savings: "1.2 s", estTime: "1 day" },
  { id: "r3", title: "Eliminate render-blocking resources", category: "Performance", savings: "0.6 s", estTime: "4 hours" },
  { id: "r4", title: "Properly size images", category: "Performance", savings: "0.9 s", estTime: "3 hours" },
];

/** Build the initial AppState identical to the prototype (mobile), with a derived desktop strategy. */
export function buildSeedState(): AppState {
  let s = 20240716;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };

  const pages: WatchPage[] = SEEDS.map((p) => {
    const history: Night[] = [];
    for (let i = 0; i < N; i++) {
      const mobile = {} as NightScores;
      for (const key of CAT_KEYS) {
        const b = p.base[key];
        let off = 0;
        if (key === "perf") {
          if (p.status === "dropped" && i >= 24) off = -11 - (i - 24) * 0.4;
          else if (p.status === "room") off = -5 - (i / N) * 1.5;
          if (p.marker && i >= p.marker.i && p.status === "dropped") off -= 2;
        }
        const noise = (rnd() - 0.5) * 4;
        const m = clamp(b + off + noise);
        const spread = key === "perf" ? 3 + rnd() * 3 : 1 + rnd() * 1.5;
        mobile[key] = { m, lo: clamp(m - spread), hi: clamp(m + spread) };
      }
      const scores: StrategyScores = { mobile, desktop: toDesktop(mobile) };
      history.push({ i, date: dateFor(i), scores, sampleSize: 5 });
    }
    const last = history[N - 1];
    const mediansOf = (ns: NightScores) => ({ perf: ns.perf.m, a11y: ns.a11y.m, bp: ns.bp.m, seo: ns.seo.m });
    const current: WatchPage["current"] = {
      mobile: mediansOf(last.scores.mobile),
      desktop: mediansOf(last.scores.desktop),
    };
    // Baseline: median + a synthetic 5-run range per category, per strategy.
    const baseMobile: NightScores = {
      perf: { m: p.base.perf, lo: clamp(p.base.perf - 3), hi: clamp(p.base.perf + 3) },
      a11y: { m: p.base.a11y, lo: clamp(p.base.a11y - 1), hi: clamp(p.base.a11y + 1) },
      bp: { m: p.base.bp, lo: clamp(p.base.bp - 1), hi: clamp(p.base.bp + 1) },
      seo: { m: p.base.seo, lo: clamp(p.base.seo - 1), hi: clamp(p.base.seo + 1) },
    };
    const baseline: StrategyScores = { mobile: baseMobile, desktop: toDesktop(baseMobile) };
    const markers = p.marker ? [{ id: `${p.id}-m0`, i: p.marker.i, date: dateFor(p.marker.i), text: p.marker.text }] : [];
    return {
      id: p.id,
      title: p.title,
      url: p.url,
      flag: p.flag,
      status: STATUS_MAP[p.status],
      baseline,
      current,
      history,
      markers,
      agent: agentFor(p.id),
      baselineCapturedAt: "Jun 17",
      acted: {},
    };
  });

  const recs: Rec[] = [];
  pages.forEach((p) =>
    REC_DEFS.forEach((rd) =>
      recs.push({
        key: `${p.id}:${rd.id}`,
        pageId: p.id,
        pageTitle: p.title,
        url: p.url,
        id: rd.id,
        title: rd.title,
        category: rd.category,
        savings: rd.savings,
        estTime: rd.estTime,
        status: "inbox",
        taskStatus: "todo",
        added: "Jul 16",
        doneDate: null,
      }),
    ),
  );
  const setSt = (key: string, status: Rec["status"], taskStatus?: Rec["taskStatus"], doneDate?: string) => {
    const r = recs.find((x) => x.key === key);
    if (!r) return;
    r.status = status;
    if (taskStatus) r.taskStatus = taskStatus;
    if (doneDate) r.doneDate = doneDate;
  };
  setSt("home:r1", "task", "todo");
  setSt("pricing:r1", "task", "in-progress");
  setSt("designer:r2", "task", "done", "Jul 12");
  setSt("hosting:r1", "task", "done", "Jul 9");
  setSt("ai:r3", "ignored");

  return { pages, recs, jobs: [], followUps: [] };
}

/** Live environments begin empty; demo/local environments retain the prototype dataset. */
export function buildInitialState(mode: string | undefined = process.env.DATASET_MODE): AppState {
  return mode === "live" ? { pages: [], recs: [], jobs: [], followUps: [] } : buildSeedState();
}
