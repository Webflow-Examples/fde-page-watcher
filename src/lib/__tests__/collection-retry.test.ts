import { describe, expect, it } from "vitest";
import {
  collectionJobIsStale,
  EVIDENCE_RETRY_GRACE_MS,
  EVIDENCE_RETRY_INTERVAL_MS,
  evidenceRetryAt,
} from "../collectionRetry";
import type { CollectionJob } from "../types";

function job(overrides: Partial<CollectionJob> = {}): CollectionJob {
  return {
    id: "job",
    runId: "job",
    pageId: "page",
    kind: "nightly",
    state: "running",
    attempts: 1,
    createdAt: "2026-08-03T09:00:00.000Z",
    updatedAt: "2026-08-03T09:00:00.000Z",
    ...overrides,
  };
}

describe("PSI evidence retry policy", () => {
  it("schedules the next evidence attempt three hours later", () => {
    expect(evidenceRetryAt(new Date("2026-08-03T09:00:00.000Z"))).toBe("2026-08-03T12:00:00.000Z");
  });

  it("does not replace a Workflow while it is sleeping for evidence", () => {
    const waiting = job({
      state: "waiting_for_evidence",
      nextRetryAt: "2026-08-03T12:00:00.000Z",
      completedStrategies: ["desktop"],
    });

    expect(collectionJobIsStale(waiting, new Date("2026-08-03T12:30:00.000Z"))).toBe(false);
    expect(collectionJobIsStale(waiting, new Date(
      Date.parse(waiting.nextRetryAt!) + EVIDENCE_RETRY_GRACE_MS + 1,
    ))).toBe(true);
  });

  it("uses the retry interval when older waiting jobs have no wake-up timestamp", () => {
    const waiting = job({ state: "waiting_for_evidence" });
    expect(collectionJobIsStale(waiting, new Date(
      Date.parse(waiting.updatedAt) + EVIDENCE_RETRY_INTERVAL_MS,
    ))).toBe(false);
  });
});
