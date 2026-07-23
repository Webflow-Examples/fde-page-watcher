import type { AgentIgnoreSettings, RangeDays, Rec, Strategy, WatchPage } from "./types";
import { summarizeAgentChecks } from "./agentScoring";
import { C } from "./ui";
import { savingsValue } from "./ui";
import { DROP_THRESHOLD, pageRangeComparison, pageRangeTrend } from "./scoring";
import { isPageActivelyMonitored } from "./watchCapacity";

/** "A" · "A and B" · "A, B and C". */
function listJoin(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface WatcherBullet {
  lead: string;
  leadColor: string;
  text: string;
}

export interface WatcherSummary {
  total: number;
  stable: number;
  improving: number;
  regressing: number;
  lowPerformance: number;
  agentGaps: number;
  qualityIssues: number;
  changed: WatcherBullet[];
  topRec: { pageTitle: string; recTitle: string; savings: string } | null;
}

export const LOW_PERFORMANCE_THRESHOLD = 60;
export const QUALITY_SCORE_THRESHOLD = 90;

function hasSnapshot(page: WatchPage): boolean {
  return page.history.length > 0 || !!page.baseline;
}

function hasAgentGap(page: WatchPage, defaults?: AgentIgnoreSettings): boolean {
  return summarizeAgentChecks(page.agent, page.agentIgnores, defaults, page.agentIgnoreRestores).fail > 0;
}

/**
 * The Watcher: an agent-authored read of current conditions, what changed over
 * the selected range, and a top recommendation (REQ-049). Derived live from stored state.
 */
export function buildWatcher(
  pages: WatchPage[],
  recs: Rec[],
  strategy: Strategy,
  rangeDays: RangeDays = 30,
  agentIgnoreDefaults?: AgentIgnoreSettings,
): WatcherSummary {
  const activePages = pages.filter(isPageActivelyMonitored);
  const trends = new Map(activePages.map((page) => [page.id, pageRangeTrend(page, strategy, rangeDays)]));
  const stable = activePages.filter((p) => trends.get(p.id) === "stable").length;
  const improving = activePages.filter((p) => trends.get(p.id) === "improving").length;
  const regressing = activePages.filter((p) => trends.get(p.id) === "regressing").length;
  const lowPerformance = activePages.filter((p) => hasSnapshot(p) && p.current[strategy].perf < LOW_PERFORMANCE_THRESHOLD).length;
  const agentGaps = activePages.filter((page) => hasAgentGap(page, agentIgnoreDefaults)).length;
  const qualityIssues = activePages.filter((p) => hasSnapshot(p) && (["a11y", "bp", "seo"] as const).some((key) => p.current[strategy][key] < QUALITY_SCORE_THRESHOLD)).length;

  const ranked = activePages.filter((p) => trends.get(p.id) !== "pending" && p.baseline);
  const regressionPages = ranked.filter((p) => trends.get(p.id) === "regressing");
  const improvingPages = ranked.filter((p) => trends.get(p.id) === "improving");

  const changed: WatcherBullet[] = [];
  for (const p of regressionPages) {
    const drop = Math.abs(pageRangeComparison(p, strategy, "perf", rangeDays)?.delta ?? 0);
    changed.push({
      lead: p.title,
      leadColor: C.red,
      text: `fell ${drop} points.`,
    });
  }
  for (const p of improvingPages) {
    const gain = Math.abs(pageRangeComparison(p, strategy, "perf", rangeDays)?.delta ?? 0);
    changed.push({
      lead: p.title,
      leadColor: C.green,
      text: `gained ${gain} points.`,
    });
  }
  const below = ranked.filter((p) => (p.current[strategy]?.perf ?? 100) < LOW_PERFORMANCE_THRESHOLD);
  if (below.length) {
    const names = below.map((p) => p.title);
    changed.push({
      lead: listJoin(names),
      leadColor: C.amber,
      text: `${names.length > 1 ? "remain" : "remains"} below the ${LOW_PERFORMANCE_THRESHOLD} Performance threshold.`,
    });
  }

  // Evaluate Accessibility and SEO over the same selected range instead of
  // asserting they are stable — the Watcher must not make unchecked claims.
  const stableCategories: string[] = [];
  if (ranked.length) {
    for (const [key, label] of [["a11y", "Accessibility"], ["seo", "SEO"]] as const) {
      const dropped = ranked.filter((p) => (pageRangeComparison(p, strategy, key, rangeDays)?.delta ?? 0) <= -DROP_THRESHOLD);
      if (dropped.length === 0) stableCategories.push(label);
      else changed.push({ lead: listJoin(dropped.map((p) => p.title)), leadColor: C.amber, text: `dropped on ${label} over the last ${rangeDays} days.` });
    }
    if (stableCategories.length) {
      changed.push({ lead: "", leadColor: "", text: `${listJoin(stableCategories)} ${stableCategories.length > 1 ? "are" : "is"} stable across the board.` });
    }
  }

  const focus = regressionPages[0] ?? [...ranked].sort((a, b) => (a.current[strategy]?.perf ?? 100) - (b.current[strategy]?.perf ?? 100))[0];
  let topRec: WatcherSummary["topRec"] = null;
  if (focus) {
    // Only recommend something still actionable — not an ignored or completed rec.
    const cand = recs
      .filter((r) => r.pageId === focus.id && r.category === "Performance" && r.status !== "ignored" && r.taskStatus !== "done")
      .sort((a, b) => savingsValue(b) - savingsValue(a))[0];
    if (cand) topRec = { pageTitle: focus.title, recTitle: cand.title, savings: cand.savings };
  }

  return { total: activePages.length, stable, improving, regressing, lowPerformance, agentGaps, qualityIssues, changed, topRec };
}
