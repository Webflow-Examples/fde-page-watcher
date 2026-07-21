import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore, type DataStore } from "../store/fsStore";
import { pendingPage } from "../mutations";
import { commitCollectionResult, enqueueCollectionJob, failCollectionJob, markCollectionJob } from "../collectionJobs";
import type { CategoryScore, CollectionResult, NightScores } from "../types";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const score = (value: number): CategoryScore => ({ m: value, lo: value - 2, hi: value + 2 });
const scores = (perf: number): NightScores => ({ perf: score(perf), a11y: score(91), bp: score(95), seo: score(98) });

async function store(): Promise<DataStore> {
  const root = await mkdtemp(path.join(tmpdir(), "fde-jobs-"));
  roots.push(root);
  const dataStore = createFsStore("jobs-test", root);
  await dataStore.updateState((state) => {
    state.pages = [pendingPage("page", "Contact sales", "https://webflow.com/enterprise/contact-sales", "priority")];
    state.recs = [];
    state.jobs = [];
    state.followUps = [];
  });
  return dataStore;
}

describe("durable collection jobs", () => {
  it("coalesces active requests and commits a baseline exactly once", async () => {
    const dataStore = await store();
    const first = await enqueueCollectionJob("page", "baseline", { dataStore, id: "job-one", now: new Date("2026-07-20T10:00:00Z") });
    const duplicate = await enqueueCollectionJob("page", "run", { dataStore, id: "job-two", now: new Date("2026-07-20T10:00:01Z") });
    expect(first.queued).toBe(true);
    expect(duplicate.coalesced).toBe(true);
    expect(duplicate.job.id).toBe("job-one");

    await markCollectionJob("job-one", "running", { dataStore, now: new Date("2026-07-20T10:00:02Z") });
    const result: CollectionResult = {
      schemaVersion: 1,
      jobId: "job-one",
      runId: "job-one",
      pageId: "page",
      capturedAt: "2026-07-20T10:03:00Z",
      scores: { mobile: scores(72), desktop: scores(91) },
      samples: { mobile: 5, desktop: 4 },
      agent: [{ name: "robots.txt", group: "Discoverability", pass: true }],
      opportunities: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 1200 }],
    };
    const committed = await commitCollectionResult(result, { strategies: { mobile: { raw: true }, desktop: { raw: true } } }, dataStore);
    expect(committed.pages[0].baseline?.mobile.perf.m).toBe(72);
    expect(committed.pages[0].history).toHaveLength(1);
    expect(committed.pages[0].history[0].opportunities?.[0].id).toBe("unused-javascript");
    expect(committed.pages[0].runState).toBeUndefined();
    expect(committed.jobs?.[0].state).toBe("succeeded");
    expect(committed.recs[0].title).toBe("Reduce unused JavaScript");
    expect(await dataStore.getReport("page", "run-job-one")).not.toBeNull();

    const repeated = await commitCollectionResult(result, {}, dataStore);
    expect(repeated.pages[0].history).toHaveLength(1);
  });

  it("surfaces terminal failures on both the job and page", async () => {
    const dataStore = await store();
    await enqueueCollectionJob("page", "run", { dataStore, id: "failed-job" });
    const failed = await failCollectionJob("failed-job", new Error("PSI quota exhausted"), dataStore);
    expect(failed.jobs?.[0]).toMatchObject({ state: "failed", error: "PSI quota exhausted" });
    expect(failed.pages[0]).toMatchObject({ runState: "failed", lastError: "PSI quota exhausted" });
  });
});
