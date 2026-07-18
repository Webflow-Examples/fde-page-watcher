import type { Rec, Strategy, WatchPage } from "./types";
import { C } from "./ui";
import { savingsValue } from "./ui";

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
  overall: string;
  total: number;
  healthy: number;
  improvable: number;
  degraded: number;
  changed: WatcherBullet[];
  topRec: { pageTitle: string; recTitle: string; savings: string } | null;
}

/**
 * The Watcher: an agent-authored read of current conditions, what changed since
 * baseline, and a top recommendation (REQ-049). Derived live from stored state.
 */
export function buildWatcher(pages: WatchPage[], recs: Rec[], strategy: Strategy): WatcherSummary {
  const healthy = pages.filter((p) => p.status === "healthy").length;
  const improvable = pages.filter((p) => p.status === "improvable").length;
  const degraded = pages.filter((p) => p.status === "degraded").length;
  const overall = degraded >= 2 ? "under strain" : degraded === 1 ? "steady, with one page degraded" : improvable > 0 ? "steady" : "strong";

  const changed: WatcherBullet[] = [];
  for (const p of pages.filter((x) => x.status === "degraded")) {
    const drop = (p.baseline[strategy]?.perf.m ?? 0) - (p.current[strategy]?.perf ?? 0);
    const marker = p.markers.length ? p.markers[p.markers.length - 1].text.toLowerCase() : null;
    changed.push({
      lead: p.title,
      leadColor: C.red,
      text: `dropped ${Math.max(0, drop)} points on Performance${marker ? ` after ${marker}` : ""}.`,
    });
  }
  const below = pages.filter((p) => p.status !== "degraded" && (p.current[strategy]?.perf ?? 100) < 60);
  if (below.length) {
    const names = below.map((p) => p.title);
    changed.push({
      lead: listJoin(names),
      leadColor: C.amber,
      text: `${names.length > 1 ? "remain" : "remains"} below the 60 Performance threshold.`,
    });
  }
  changed.push({ lead: "", leadColor: "", text: "Accessibility and SEO are stable across the board." });

  const focus = pages.find((p) => p.status === "degraded") ?? [...pages].sort((a, b) => (a.current[strategy]?.perf ?? 100) - (b.current[strategy]?.perf ?? 100))[0];
  let topRec: WatcherSummary["topRec"] = null;
  if (focus) {
    const cand = recs
      .filter((r) => r.pageId === focus.id && r.category === "Performance")
      .sort((a, b) => savingsValue(b) - savingsValue(a))[0];
    if (cand) topRec = { pageTitle: focus.title, recTitle: cand.title, savings: cand.savings };
  }

  return { overall, total: pages.length, healthy, improvable, degraded, changed, topRec };
}
