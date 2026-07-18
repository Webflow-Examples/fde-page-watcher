import { getStore } from "./store";
import { collect } from "./psi";
import { scan } from "./agentReadiness";
import { costBand } from "./cost";
import { postAlert, postFollowup } from "./slack";
import { classifyStatus, mediansOf, DROP_THRESHOLD } from "./scoring";
import { shortDate } from "./ui";
import { CATEGORIES, STRATEGIES } from "./types";
import type { AppState, Night, Rec, StrategyScores, WatchPage } from "./types";

/**
 * Run the full collection path for a single page: 5 PSI runs per strategy, an
 * agent-readiness scan, the storage fan-out, new recommendations into the
 * Inbox, and drop alerting (REQ-013/014/015/016/050/055/017). Used by both the
 * nightly job and the on-demand "Run now".
 */
export async function runPage(pageId: string): Promise<AppState> {
  const s = getStore();
  const state = await s.getState();
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`runPage: page ${pageId} not found`);

  const scores = {} as StrategyScores;
  const raw: Record<string, unknown> = {};
  let sampleSize = 5;
  let opportunities: { id: string; title: string; savingsMs: number }[] = [];
  for (const strat of STRATEGIES) {
    const res = await collect(page.url, strat);
    scores[strat] = res.scores;
    raw[strat] = res.raw;
    sampleSize = Math.min(sampleSize, res.sampleSize);
    if (strat === "mobile") opportunities = res.opportunities;
  }

  const iso = new Date().toISOString();
  const night: Night = {
    i: page.history.length,
    date: shortDate(),
    iso,
    scores,
    sampleSize,
    rawReportKey: `${iso.slice(0, 10)}-${page.history.length}`,
  };

  // Agent-readiness scan, with regressions computed against the prior scan.
  const prev = page.agent;
  const fresh = await scan(page.url);
  const agent = fresh.map((c) => {
    const before = prev.find((x) => x.name === c.name);
    return { ...c, regressed: !!before && before.pass && !c.pass };
  });

  // Storage fan-out: sequential append + snapshot + status + object report.
  const next = await s.appendNight(pageId, night, raw);
  const pg = next.pages.find((p) => p.id === pageId)!;
  pg.agent = agent;

  // New recommendations → Inbox (dedup by key; keep existing lifecycle state).
  const today = shortDate();
  for (const op of opportunities.slice(0, 6)) {
    const key = `${pageId}:${op.id}`;
    // Dedup by key (same audit) and by title (avoids seed/real overlap).
    const title = op.title.trim().toLowerCase();
    if (next.recs.some((r) => r.key === key || (r.pageId === pageId && r.title.trim().toLowerCase() === title))) continue;
    const rec: Rec = {
      key,
      pageId,
      pageTitle: pg.title,
      url: pg.url,
      id: op.id,
      title: op.title,
      category: "Performance",
      savings: `${(op.savingsMs / 1000).toFixed(1)} s`,
      estTime: costBand(`${op.id} ${op.title}`),
      status: "inbox",
      taskStatus: "todo",
      added: today,
      doneDate: null,
    };
    next.recs.push(rec);
  }
  await s.saveState(next);

  await maybeAlert(pg);
  return next;
}

async function maybeAlert(page: WatchPage): Promise<void> {
  if (page.status !== "degraded") return;
  const base = mediansOf(page.baseline.mobile);
  const affected = CATEGORIES.filter((c) => base[c.key] - page.current.mobile[c.key] >= DROP_THRESHOLD).map((c) => c.label);
  if (affected.length) await postAlert(page.title, page.url, affected);
}

/** Capture (or re-capture) a baseline: the same five-run median path, per strategy (REQ-012). */
export async function captureBaseline(pageId: string): Promise<AppState> {
  const s = getStore();
  const state = await s.getState();
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`captureBaseline: page ${pageId} not found`);

  const baseline = {} as StrategyScores;
  for (const strat of STRATEGIES) {
    const res = await collect(page.url, strat);
    baseline[strat] = res.scores;
  }
  page.baseline = baseline;
  page.baselineCapturedAt = shortDate();
  page.status = classifyStatus(mediansOf(baseline.mobile), page.history, "mobile");
  await s.saveState(state);
  return state;
}

/** Nightly job: priority pages first, both strategies, then due follow-ups (REQ-013/044/045). */
export async function runNightly(): Promise<{ ran: number; failed: string[] }> {
  const s = getStore();
  const state = await s.getState();
  const ordered = [...state.pages].sort((a, b) => (a.flag === "priority" ? 0 : 1) - (b.flag === "priority" ? 0 : 1));
  const failed: string[] = [];
  for (const p of ordered) {
    try {
      await runPage(p.id);
    } catch (err) {
      console.error(`[collector] ${p.id} failed`, err);
      failed.push(p.id);
    }
  }
  await processFollowUps();
  return { ran: ordered.length - failed.length, failed };
}

/** Fire any due 2/7/30-day follow-up comparisons and mark them sent (REQ-045/046). */
export async function processFollowUps(): Promise<void> {
  const s = getStore();
  const state = await s.getState();
  const now = Date.now();
  let changed = false;
  for (const fu of state.followUps ?? []) {
    if (fu.sent || Date.parse(fu.dueISO) > now) continue;
    const page = state.pages.find((p) => p.id === fu.pageId);
    if (!page) {
      fu.sent = true;
      changed = true;
      continue;
    }
    const markerI = page.markers.find((m) => m.text === fu.markerText)?.i ?? page.history.length - 1;
    const beforeNight = page.history[Math.max(0, markerI - 1)] ?? page.history[page.history.length - 1];
    const lines = CATEGORIES.map((c) => {
      const before = beforeNight.scores.mobile[c.key].m;
      const after = page.current.mobile[c.key];
      const d = after - before;
      return `${c.label}: ${before} → ${after} (${d >= 0 ? "+" : ""}${d})`;
    });
    await postFollowup(page.title, fu.interval, lines);
    fu.sent = true;
    changed = true;
  }
  if (changed) await s.saveState(state);
}
