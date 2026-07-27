import { describe, expect, it } from "vitest";
import {
  collectionInstant,
  collectionOffsets,
  ensureCollectionOffsets,
  pageScheduleDue,
} from "../collectionSchedule";
import { pendingPage } from "../mutations";
import type { CollectionSchedule } from "../types";

const schedule: CollectionSchedule = {
  localTime: "00:00",
  timeZone: "America/Chicago",
  overridden: false,
};

describe("collection scheduling", () => {
  it("resolves midnight in the saved timezone across daylight-saving offsets", () => {
    expect(collectionInstant(schedule, "2026-01-15").toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(collectionInstant(schedule, "2026-07-15").toISOString()).toBe("2026-07-15T05:00:00.000Z");
  });

  it("assigns active pages stable non-overlapping offsets", () => {
    const pages = [
      pendingPage("page-a", "A", "https://example.com/a", "priority"),
      pendingPage("page-b", "B", "https://example.com/b", "watching"),
      pendingPage("page-c", "C", "https://example.com/c", "paused"),
    ];
    ensureCollectionOffsets(pages);
    const first = collectionOffsets(pages);
    const before = first.get("page-a");
    pages.push(pendingPage("page-d", "D", "https://example.com/d", "watching"));
    ensureCollectionOffsets(pages);
    expect(collectionOffsets(pages).get("page-a")).toBe(before);
    const second = collectionOffsets([...pages].reverse());
    expect(first.get("page-a")).toBe(second.get("page-a"));
    expect(first.get("page-b")).toBe(second.get("page-b"));
    expect(first.has("page-c")).toBe(false);
    expect(new Set(collectionOffsets(pages).values()).size).toBe(3);
  });

  it("dispatches a page only once for its local daily cohort", () => {
    const page = pendingPage("page-a", "A", "https://example.com/a", "priority");
    page.collectionOffsetMinutes = 0;
    const now = new Date("2026-07-27T06:00:00.000Z");
    const first = pageScheduleDue(page, [page], schedule, now);
    expect(first).toMatchObject({
      due: true,
      scheduledAt: "2026-07-27T05:00:00.000Z",
      cohortId: "nightly:2026-07-27",
    });
    page.lastScheduledAt = first.scheduledAt;
    expect(pageScheduleDue(page, [page], schedule, now).due).toBe(false);
  });
});
