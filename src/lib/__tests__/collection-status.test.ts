import { describe, expect, it } from "vitest";
import { buildSeedState } from "../seed";
import { lastSuccessfulRunAt, latestSuccessfulRunAt } from "../collectionStatus";

describe("successful collection timestamps", () => {
  it("uses the latest committed live history entry rather than a failed lastRunAt", () => {
    const page = buildSeedState().pages[0];
    page.history[page.history.length - 2].iso = "2026-07-21T03:00:00.000Z";
    page.history[page.history.length - 1].iso = "2026-07-22T03:04:00.000Z";
    page.lastRunAt = "2026-07-22T05:00:00.000Z";
    page.runState = "failed";

    expect(lastSuccessfulRunAt(page)).toBe("2026-07-22T03:04:00.000Z");
  });

  it("finds the most recent successful run across the watchlist", () => {
    const pages = buildSeedState().pages.slice(0, 2);
    pages[0].history[pages[0].history.length - 1].iso = "2026-07-22T03:04:00.000Z";
    pages[1].history[pages[1].history.length - 1].iso = "2026-07-22T03:08:00.000Z";

    expect(latestSuccessfulRunAt(pages)).toBe("2026-07-22T03:08:00.000Z");
  });

  it("does not present undated demo history as a live success", () => {
    const page = buildSeedState().pages[0];
    expect(lastSuccessfulRunAt(page)).toBeNull();
  });
});
