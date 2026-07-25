import { describe, expect, it } from "vitest";
import {
  applyWatchlistPageOrder,
  changePageFlagOrder,
  movePageWithinFlag,
  reorderPageWithinFlag,
  sortWatchlistPages,
} from "../watchlistOrder";
import type { Flag } from "../types";

const page = (id: string, flag: Flag) => ({ id, flag });

describe("watchlist ordering", () => {
  const mixed = [
    page("watching-a", "watching"),
    page("paused-a", "paused"),
    page("priority-a", "priority"),
    page("watching-b", "watching"),
    page("priority-b", "priority"),
  ];

  it("groups Priority, Watching, and Paused while preserving tier order", () => {
    expect(sortWatchlistPages(mixed).map((item) => item.id)).toEqual([
      "priority-a",
      "priority-b",
      "watching-a",
      "watching-b",
      "paused-a",
    ]);
  });

  it("moves a changed flag to the end of its new tier", () => {
    expect(changePageFlagOrder(mixed, "priority-a", "watching").map((item) => item.id)).toEqual([
      "priority-b",
      "watching-a",
      "watching-b",
      "priority-a",
      "paused-a",
    ]);
  });

  it("moves one keyboard slot without crossing flag tiers", () => {
    const ordered = sortWatchlistPages(mixed);
    expect(movePageWithinFlag(ordered, "priority-a", 1).map((item) => item.id))
      .toEqual(["priority-b", "priority-a", "watching-a", "watching-b", "paused-a"]);
    expect(movePageWithinFlag(ordered, "priority-a", -1).map((item) => item.id))
      .toEqual(ordered.map((item) => item.id));
  });

  it("drops before or after a page in the same tier without crossing tiers", () => {
    const ordered = sortWatchlistPages(mixed);
    expect(reorderPageWithinFlag(ordered, "priority-a", "priority-b", "after").map((item) => item.id))
      .toEqual(["priority-b", "priority-a", "watching-a", "watching-b", "paused-a"]);
    expect(reorderPageWithinFlag(ordered, "watching-b", "watching-a", "before").map((item) => item.id))
      .toEqual(["priority-a", "priority-b", "watching-b", "watching-a", "paused-a"]);
    expect(reorderPageWithinFlag(ordered, "watching-a", "priority-a", "after").map((item) => item.id))
      .toEqual(ordered.map((item) => item.id));
  });

  it("applies a complete persisted permutation and rejects incomplete orders", () => {
    expect(applyWatchlistPageOrder(mixed, [
      "priority-b",
      "priority-a",
      "paused-a",
      "watching-b",
      "watching-a",
    ]).map((item) => item.id)).toEqual([
      "priority-b",
      "priority-a",
      "watching-b",
      "watching-a",
      "paused-a",
    ]);
    expect(() => applyWatchlistPageOrder(mixed, ["priority-a"]))
      .toThrow("include every page exactly once");
  });
});
