import { describe, expect, it } from "vitest";
import { sortDashboardRows } from "../dashboardSort";
import type { Flag } from "../types";

function row(id: string, monitoringFlag: Flag, title: string, watchlistOrder: number) {
  return {
    id,
    monitoringFlag,
    watchlistOrder,
    sortVals: { title, perf: title.length },
  };
}

describe("sortDashboardRows", () => {
  const mixedRows = [
    row("watching-a", "watching", "Charlie", 4),
    row("paused-a", "paused", "Zulu", 7),
    row("priority-a", "priority", "Bravo", 2),
    row("watching-b", "watching", "Delta", 3),
    row("priority-b", "priority", "Alpha", 0),
    row("paused-b", "paused", "Echo", 6),
  ];

  it("defaults to flag hierarchy, then the manual Watchlist order", () => {
    expect(sortDashboardRows(mixedRows, { col: null, dir: "desc" }).map((item) => item.id))
      .toEqual([
        "priority-b",
        "priority-a",
        "watching-b",
        "watching-a",
        "paused-b",
        "paused-a",
      ]);
  });

  it("lets an explicit column sort override the monitoring hierarchy", () => {
    expect(sortDashboardRows(mixedRows, { col: "title", dir: "desc" }).map((item) => item.id))
      .toEqual([
        "paused-a",
        "paused-b",
        "watching-b",
        "watching-a",
        "priority-a",
        "priority-b",
      ]);
  });

  it("does not mutate the source rows", () => {
    const sourceOrder = mixedRows.map((item) => item.id);
    sortDashboardRows(mixedRows, { col: null, dir: "desc" });
    expect(mixedRows.map((item) => item.id)).toEqual(sourceOrder);
  });
});
