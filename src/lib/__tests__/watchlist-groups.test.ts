import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pendingPage } from "../mutations";
import { normalizeState } from "../store/normalize";
import { MAX_PRIORITY_PAGES } from "../watchCapacity";
import { WATCHLIST_PAUSED_NOTE, watchlistGroupLabel } from "../watchlist-copy";
import {
  applyWatchlistPageOrder,
  changePageFlagOrder,
  reorderPageWithinFlag,
  sortWatchlistPages,
  WATCHLIST_TIERS,
} from "../watchlistOrder";
import type { AppState, Flag } from "../types";

/**
 * C2's guards: the watchlist's three tier groups.
 *
 * The tiers were always there — `sortWatchlistPages` has grouped them since the
 * order landed. What C2 added is the heading over each one, so what needs
 * guarding is the join: a group heading that disagrees with the sort puts rows
 * under the wrong tier, and no type catches that.
 */

const ROOT = path.join(__dirname, "..", "..", "..");
const source = (relativePath: string) => readFileSync(path.join(ROOT, relativePath), "utf8");

const importedModules = (relativePath: string) =>
  [...source(relativePath).matchAll(/(?:^|\n)\s*import[^;]*?from\s*["']([^"']+)["']/g)]
    .map((match) => match[1]);

const WATCHLIST_SOURCE = "src/app/(app)/watchlist/page.tsx";

const page = (id: string, flag: Flag) => ({ id, flag });

/** The screen's own grouping, written once here so the tests exercise it. */
const groupByTier = <T extends { flag: Flag }>(pages: ReadonlyArray<T>) =>
  WATCHLIST_TIERS.map((tier) => ({ tier, tierPages: pages.filter((item) => item.flag === tier) }));

describe("watchlist tier groups", () => {
  const mixed = [
    page("watching-a", "watching"),
    page("paused-a", "paused"),
    page("priority-a", "priority"),
    page("watching-b", "watching"),
    page("priority-b", "priority"),
  ];

  it("renders the groups in the order the sort already puts the rows in", () => {
    const ordered = sortWatchlistPages(mixed);
    const grouped = groupByTier(ordered).flatMap((group) => group.tierPages);

    // The join C2 introduced: heading order and row order are the same fact, so
    // reading the rows group by group must reproduce the flat sort exactly.
    expect(grouped.map((item) => item.id)).toEqual(ordered.map((item) => item.id));
    // And no page falls outside a group — a tier missing from WATCHLIST_TIERS
    // would silently drop its rows rather than fail to compile.
    expect(grouped).toHaveLength(mixed.length);
  });

  it("moves a page's group when its tier changes, to the end of the tier it joins", () => {
    const moved = changePageFlagOrder(sortWatchlistPages(mixed), "priority-a", "watching");
    const groups = groupByTier(moved);

    expect(groups.map((group) => group.tier)).toEqual(["priority", "watching", "paused"]);
    expect(groups[0].tierPages.map((item) => item.id)).toEqual(["priority-b"]);
    expect(groups[1].tierPages.map((item) => item.id)).toEqual(["watching-a", "watching-b", "priority-a"]);
  });

  it("states the priority cap the capacity rule enforces, rather than a second copy of it", () => {
    // If MAX_PRIORITY_PAGES ever moves, the heading moves with it. A literal 3
    // here would pass while the heading and the rule disagreed.
    expect(watchlistGroupLabel("priority", 2)).toBe(`Priority · 2 of ${MAX_PRIORITY_PAGES}`);
    expect(watchlistGroupLabel("watching", 4)).toBe("Watching · 4");
    expect(watchlistGroupLabel("paused", 0)).toBe("Paused · 0");
  });

  it("says what Paused costs, and says it once", () => {
    expect(WATCHLIST_PAUSED_NOTE).toBe(
      "A paused page keeps its history. It loses its priority and its place in the order until it is watched again.",
    );
    // The note names only what this screen shows. Consent is project-level and
    // origin-scoped and is not on the watchlist, so the note must not claim a
    // paused page keeps a consent record a reader cannot see.
    expect(WATCHLIST_PAUSED_NOTE).not.toContain("consent");
    // The note is authored in one module and rendered from it, not retyped in
    // the screen — registry rule 20.
    expect(source(WATCHLIST_SOURCE)).not.toContain("A paused page keeps its history");
  });

  it("gives a paused row no drag handle at all, rather than a disabled one", () => {
    const watchlist = source(WATCHLIST_SOURCE);
    const pausedGuard = watchlist.indexOf('p.flag === "paused" ? (');
    const handle = watchlist.indexOf("watchlist-drag-handle");

    expect(pausedGuard).toBeGreaterThan(-1);
    expect(handle).toBeGreaterThan(-1);
    // The guard precedes the handle, so a paused row never reaches it: the
    // handle lives in the else branch, after the ternary's separator.
    const elseBranch = watchlist.indexOf(") : (", pausedGuard);
    expect(elseBranch).toBeGreaterThan(pausedGuard);
    expect(elseBranch).toBeLessThan(handle);

    const pausedBranch = watchlist.slice(pausedGuard, elseBranch);
    expect(pausedBranch).toContain('<div aria-hidden="true" />');
    // Absent, not disabled: a control that can never act should not be in the
    // tab order announcing itself as unavailable.
    expect(pausedBranch).not.toContain("<button");
    // The attribute form, not the word: the branch's own comment says
    // "Absent, not disabled", and that sentence is not a control.
    expect(pausedBranch).not.toContain("disabled=");
  });

  it("keeps a paused page's history and its place in the list", () => {
    const paused = pendingPage("paused-page", "Paused page", "https://example.com/paused", "paused");
    const active = pendingPage("active-page", "Active page", "https://example.com/active", "priority");
    paused.history = [{ date: "2026-08-01", scores: {} } as never];
    paused.baselineCapturedAt = "2026-08-01T00:00:00.000Z";

    const normalized = normalizeState({ pages: [active, paused], recs: [] } as unknown as AppState);
    const stillPaused = normalized.pages.find((item) => item.id === "paused-page");

    // Pausing is a scope decision, not a deletion: the row survives a state
    // read with its history and its capture time intact.
    expect(stillPaused?.flag).toBe("paused");
    expect(stillPaused?.history).toHaveLength(1);
    expect(stillPaused?.baselineCapturedAt).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("watchlist order reaches every list that shows pages", () => {
  it("survives a state read, which is what every consumer of state.pages gets", () => {
    const pages = [
      pendingPage("w1", "One", "https://example.com/1", "watching"),
      pendingPage("w2", "Two", "https://example.com/2", "watching"),
      pendingPage("w3", "Three", "https://example.com/3", "watching"),
    ];
    const reordered = reorderPageWithinFlag(pages, "w3", "w1", "before");
    expect(reordered.map((item) => item.id)).toEqual(["w3", "w1", "w2"]);

    // Consumer one: `normalizeState` re-sorts on every read, so an order that
    // did not survive it would be an order nothing downstream ever sees.
    const normalized = normalizeState({
      pages: applyWatchlistPageOrder(pages, ["w3", "w1", "w2"]),
      recs: [],
    } as unknown as AppState);
    expect(normalized.pages.map((item) => item.id)).toEqual(["w3", "w1", "w2"]);
  });

  it("is read, not recomputed, by the other screens that list pages", () => {
    // Consumer two: the Pages screen maps the stored order straight through —
    // it names the index `watchlistOrder` rather than sorting again.
    expect(source("src/app/(app)/pages/pages-content.tsx")).toContain("pages.map((p, watchlistOrder)");

    // Consumer three: the nightly queue puts Priority first with a stable sort,
    // so the manual order inside each tier still decides who runs first.
    const nightly = source("src/app/api/cron/nightly/route.ts");
    expect(nightly).toContain("isPageActivelyMonitored");
    expect(nightly).toContain('.sort((a, b) => (a.flag === "priority" ? 0 : 1) - (b.flag === "priority" ? 0 : 1))');
  });
});

describe("watchlist route boundary", () => {
  it("pulls no health, trend, score or case data", () => {
    const imports = importedModules(WATCHLIST_SOURCE);
    for (const forbidden of [
      "@/lib/scoring",
      "@/lib/dashboardVerdict",
      "@/lib/performanceIssues",
      "@/lib/issue-case",
      "@/lib/agentIssueCases",
      "@/lib/agentScoring",
      "@/lib/agentHistory",
    ]) {
      expect(imports).not.toContain(forbidden);
    }
  });

  it("titles itself with the one route header the other destinations use", () => {
    for (const route of [
      WATCHLIST_SOURCE,
      "src/app/(app)/issues/page.tsx",
      "src/app/(app)/pages/pages-content.tsx",
      "src/app/(app)/settings/page.tsx",
    ]) {
      expect(importedModules(route)).toContain("@/components/page-header");
    }
  });

  it("keeps the purpose sentence and the capacity line it was handed", () => {
    const watchlist = source(WATCHLIST_SOURCE);
    expect(watchlist).toContain(
      'purpose="Priority and Watching pages are monitored nightly. Paused pages keep their history without collecting new data."',
    );
    expect(watchlist).toContain('<Magnitude value={`${capacity.active}/${MAX_ACTIVE_PAGES}`} unit="active" fontSize={12} />');
    expect(watchlist).toContain('<Magnitude value={`${capacity.priority}/${MAX_PRIORITY_PAGES}`} unit="Priority" fontSize={12} />');
    expect(watchlist).toContain('<Magnitude value={capacity.paused} unit="Paused" fontSize={12} />');
  });
});
