import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore, type DataStore } from "../store/fsStore";
import { pendingPage } from "../mutations";
import { commitCollectionResult, enqueueCollectionJob, failCollectionJob, markCollectionJob, reconcileCollectionJobs } from "../collectionJobs";
import type { CategoryScore, CollectionResult, NightScores } from "../types";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const score = (value: number): CategoryScore => ({ m: value, lo: value - 2, hi: value + 2 });
const scores = (perf: number): NightScores => ({ perf: score(perf), a11y: score(91), bp: score(95), seo: score(98) });

function collectionResult(jobId: string): CollectionResult {
  return {
    schemaVersion: 1,
    jobId,
    runId: jobId,
    pageId: "page",
    capturedAt: "2026-07-20T10:03:00Z",
    scores: { mobile: scores(72), desktop: scores(91) },
    samples: { mobile: 5, desktop: 4 },
    agent: [{ name: "robots.txt", group: "Discoverability", pass: true }],
    opportunities: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 1200 }],
  };
}

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
    const result = collectionResult("job-one");
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

  it("polls a completed Workflow and imports its staged reports", async () => {
    const dataStore = await store();
    await enqueueCollectionJob("page", "baseline", { dataStore, id: "polled-job" });
    await markCollectionJob("polled-job", "dispatching", { dataStore, workflowId: "polled-job" });
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer shared-secret");
      if (url.endsWith("/jobs/polled-job")) return Response.json({ status: "complete", output: collectionResult("polled-job") });
      if (url.endsWith("/reports/mobile")) return Response.json({ strategy: "mobile", raws: [{ id: "mobile-raw" }] });
      if (url.endsWith("/reports/desktop")) return Response.json({ strategy: "desktop", raws: [{ id: "desktop-raw" }] });
      if (url.endsWith("/reports") && init?.method === "DELETE") return Response.json({ ok: true });
      return new Response("not found", { status: 404 });
    });

    const state = await reconcileCollectionJobs({
      dataStore,
      fetchFn: fetchFn as typeof fetch,
      collectorUrl: "https://collector.example.test/jobs",
      collectorSecret: "shared-secret",
    });

    expect(state.jobs?.[0].state).toBe("succeeded");
    expect(state.pages[0].baseline?.mobile.perf.m).toBe(72);
    expect(state.pages[0].runState).toBeUndefined();
    expect(await dataStore.getReport("page", "run-polled-job")).toMatchObject({
      strategies: {
        mobile: { strategy: "mobile", raws: [{ id: "mobile-raw" }] },
        desktop: { strategy: "desktop", raws: [{ id: "desktop-raw" }] },
      },
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://collector.example.test/jobs/polled-job/reports",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("keeps transient collector outages retryable and surfaces terminal Workflow errors", async () => {
    const dataStore = await store();
    await enqueueCollectionJob("page", "run", { dataStore, id: "retry-job" });
    await markCollectionJob("retry-job", "dispatching", { dataStore, workflowId: "retry-job" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const retryable = await reconcileCollectionJobs({
      dataStore,
      fetchFn: vi.fn(async () => new Response("unavailable", { status: 503 })) as typeof fetch,
      collectorUrl: "https://collector.example.test/jobs",
      collectorSecret: "shared-secret",
    });
    expect(retryable.jobs?.[0].state).toBe("dispatching");

    const failed = await reconcileCollectionJobs({
      dataStore,
      fetchFn: vi.fn(async () => Response.json({ status: "errored", error: { message: "PSI quota exhausted" } })) as typeof fetch,
      collectorUrl: "https://collector.example.test/jobs",
      collectorSecret: "shared-secret",
    });
    expect(failed.jobs?.[0]).toMatchObject({ state: "failed", error: "PSI quota exhausted" });
    expect(failed.pages[0]).toMatchObject({ runState: "failed", lastError: "PSI quota exhausted" });
    log.mockRestore();
  });
});
