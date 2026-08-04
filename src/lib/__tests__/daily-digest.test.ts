import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureDailyDigest, ensureScheduledDailyDigest, processDailyDigests } from "../dailyDigest";
import { pendingPage } from "../mutations";
import { createFsStore, type DataStore } from "../store/fsStore";
import type { AppState, CollectionJob } from "../types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

function job(pageId: string, state: CollectionJob["state"]): CollectionJob {
  return {
    id: `job-${pageId}`,
    runId: `run-${pageId}`,
    pageId,
    kind: "nightly",
    state,
    attempts: 1,
    createdAt: "2026-08-04T06:00:00.000Z",
    updatedAt: "2026-08-04T06:30:00.000Z",
    cohortId: "nightly:2026-08-04",
  };
}

async function digestStore(): Promise<DataStore> {
  const root = await mkdtemp(path.join(tmpdir(), "fde-digest-"));
  roots.push(root);
  const dataStore = createFsStore("test", root);
  await dataStore.updateState((state) => {
    const initial: AppState = {
      pages: [
        pendingPage("home", "Homepage", "https://example.com", "priority"),
        pendingPage("pricing", "Pricing", "https://example.com/pricing", "watching"),
      ],
      recs: [],
      jobs: [job("home", "succeeded"), job("pricing", "running")],
      followUps: [],
      alertWebhookUrl: "https://hooks.example.com/page-watch",
    };
    Object.assign(state, initial);
    ensureDailyDigest(state, "nightly:2026-08-04", ["home", "pricing"], new Date("2026-08-04T06:00:00.000Z"));
  });
  return dataStore;
}

describe("daily alert digests", () => {
  it("does not snapshot today's cohort until its final collection slot", async () => {
    const dataStore = await digestStore();
    await dataStore.updateState((state) => {
      state.alertDigests = [];
      state.collectionSchedule = { localTime: "00:00", timeZone: "UTC", overridden: true };
      state.pages[0].collectionOffsetMinutes = 0;
      state.pages[1].collectionOffsetMinutes = 15;
    });

    await ensureScheduledDailyDigest(dataStore, new Date("2026-08-04T00:14:00.000Z"));
    expect((await dataStore.getState()).alertDigests?.some((digest) => digest.cohortId === "nightly:2026-08-04")).toBe(false);
    await ensureScheduledDailyDigest(dataStore, new Date("2026-08-04T00:15:00.000Z"));
    expect((await dataStore.getState()).alertDigests).toContainEqual(
      expect.objectContaining({
        cohortId: "nightly:2026-08-04",
        expectedPageIds: ["home", "pricing"],
      }),
    );
  });

  it("waits for every expected page and claims concurrent delivery only once", async () => {
    const dataStore = await digestStore();
    const alertFn = vi.fn(async () => ({ sent: true, status: 200 }));
    expect(await processDailyDigests(dataStore, new Date("2026-08-04T06:45:00.000Z"), alertFn)).toBe(0);
    expect(alertFn).not.toHaveBeenCalled();

    await dataStore.updateState((state) => {
      const pricing = state.jobs?.find((candidate) => candidate.pageId === "pricing");
      if (pricing) pricing.state = "succeeded";
    });
    await Promise.all([
      processDailyDigests(dataStore, new Date("2026-08-04T07:00:00.000Z"), alertFn),
      processDailyDigests(dataStore, new Date("2026-08-04T07:00:00.000Z"), alertFn),
    ]);

    expect(alertFn).toHaveBeenCalledTimes(1);
    expect((await dataStore.getState()).alertDigests?.[0]).toMatchObject({
      attempts: 1,
      completedAt: "2026-08-04T07:00:00.000Z",
      sentAt: "2026-08-04T07:00:00.000Z",
    });
  });

  it("keeps failed deliveries retryable", async () => {
    const dataStore = await digestStore();
    await dataStore.updateState((state) => {
      for (const candidate of state.jobs ?? []) candidate.state = "succeeded";
    });
    const alertFn = vi.fn()
      .mockResolvedValueOnce({ sent: false, status: 500, error: "unavailable" })
      .mockResolvedValueOnce({ sent: true, status: 204 });

    await processDailyDigests(dataStore, new Date("2026-08-04T07:00:00.000Z"), alertFn);
    expect((await dataStore.getState()).alertDigests?.[0]).toMatchObject({ attempts: 1, lastError: "unavailable" });
    await processDailyDigests(dataStore, new Date("2026-08-04T07:01:00.000Z"), alertFn);
    expect(alertFn).toHaveBeenCalledTimes(2);
    expect((await dataStore.getState()).alertDigests?.[0]).toMatchObject({ attempts: 2, sentAt: "2026-08-04T07:01:00.000Z" });
  });
});
