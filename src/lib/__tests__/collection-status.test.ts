import { describe, expect, it } from "vitest";
import { buildSeedState } from "../seed";
import { failedRunDetailMessage, failedRunLabel, lastSuccessfulRunAt, latestSuccessfulRunAt } from "../collectionStatus";

describe("successful collection timestamps", () => {
  it("uses the latest committed live history entry rather than a failed lastRunAt", () => {
    const page = buildSeedState().pages[0];
    page.history[page.history.length - 2].iso = "2026-07-21T03:00:00.000Z";
    page.history[page.history.length - 2].strategyCapturedAt = undefined;
    page.history[page.history.length - 1].iso = "2026-07-22T03:04:00.000Z";
    page.history[page.history.length - 1].strategyCapturedAt = undefined;
    page.lastRunAt = "2026-07-22T05:00:00.000Z";
    page.runState = "failed";

    expect(lastSuccessfulRunAt(page)).toBe("2026-07-22T03:04:00.000Z");
  });

  it("finds the most recent successful run across the watchlist", () => {
    const pages = buildSeedState().pages.slice(0, 2);
    pages[0].history[pages[0].history.length - 1].iso = "2026-07-22T03:04:00.000Z";
    pages[0].history[pages[0].history.length - 1].strategyCapturedAt = undefined;
    pages[1].history[pages[1].history.length - 1].iso = "2026-07-22T03:08:00.000Z";
    pages[1].history[pages[1].history.length - 1].strategyCapturedAt = undefined;

    expect(latestSuccessfulRunAt(pages)).toBe("2026-07-22T03:08:00.000Z");
  });

  it("presents the refreshed, date-relative demo history as a recent success", () => {
    const page = buildSeedState().pages[0];
    expect(lastSuccessfulRunAt(page)).toBe(page.history.at(-1)?.strategyCapturedAt?.desktop);
  });

  it("ignores an agent-only event when reporting the last PSI success", () => {
    const page = buildSeedState().pages[0];
    page.history = [
      { ...page.history[0], iso: "2026-08-01T03:00:00.000Z", strategyCapturedAt: undefined },
      {
        ...page.history[1],
        iso: "2026-08-02T03:00:00.000Z",
        availableStrategies: [],
        strategyCapturedAt: undefined,
        agent: [],
        agentCapturedAt: "2026-08-02T03:00:00.000Z",
      },
    ];

    expect(lastSuccessfulRunAt(page)).toBe("2026-08-01T03:00:00.000Z");
  });

  it("uses a successful device's own capture time from a partial event", () => {
    const page = buildSeedState().pages[0];
    page.history = [{
      ...page.history[0],
      iso: "2026-08-01T03:00:00.000Z",
      availableStrategies: ["mobile"],
      strategyCapturedAt: { mobile: "2026-08-01T03:07:00.000Z" },
    }];

    expect(lastSuccessfulRunAt(page)).toBe("2026-08-01T03:07:00.000Z");
  });

  it("summarizes a failed run using the last successful capture", () => {
    const page = buildSeedState().pages[0];
    page.history[page.history.length - 1].iso = "2026-07-21T03:04:00.000Z";
    page.history[page.history.length - 1].strategyCapturedAt = undefined;
    page.history = page.history.slice(-1);
    page.lastRunAt = "2026-07-27T05:00:00.000Z";
    page.lastError = "Run exceeded the 30 minute stale limit";
    page.runState = "failed";

    expect(failedRunLabel(page, new Date("2026-07-27T18:00:00.000Z"))).toBe(
      "Failed run; last captured 6 days ago",
    );
  });

  it("uses a plain fallback when no successful capture exists", () => {
    const page = buildSeedState().pages[0];
    page.history = [];
    page.runState = "failed";

    expect(failedRunLabel(page)).toBe("Failed run; no successful capture yet");
  });

  it("hides the run ID from stale-run detail messages", () => {
    expect(
      failedRunDetailMessage(
        "Run ef6641a9-781d-44cb-98e2-2632f721a370 exceeded the 30 minute stale limit",
      ),
    ).toBe(
      "Run exceeded the 30-minute stale limit. Run a scan now manually or wait for the next nightly run.",
    );
  });
});
