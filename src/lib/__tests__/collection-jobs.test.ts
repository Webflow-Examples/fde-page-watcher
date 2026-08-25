import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore, type DataStore } from "../store/fsStore";
import { pendingPage } from "../mutations";
import {
  commitCollectionResult,
  dispatchCollectionJobs,
  enqueueCollectionJob,
  failCollectionJob,
  markCollectionJob,
  reconcileCollectionJobs,
} from "../collectionJobs";
import type { CategoryScore, CollectionResult, NightScores } from "../types";
import { nativeElementScan } from "../nativeElements";
import type { CruxPageEvidence } from "../crux";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const score = (value: number): CategoryScore => ({ m: value, lo: value - 2, hi: value + 2 });
const scores = (perf: number): NightScores => ({ perf: score(perf), a11y: score(91), bp: score(95), seo: score(98) });

function collectionResult(jobId: string, schemaVersion: 1 | 2 = 1): CollectionResult {
  return {
    schemaVersion,
    jobId,
    runId: jobId,
    pageId: "page",
    capturedAt: "2026-07-20T10:03:00Z",
    scores: { mobile: scores(72), desktop: scores(91) },
    samples: { mobile: 5, desktop: 4 },
    agent: [{ name: "robots.txt", group: "Discoverability", pass: true }],
    opportunities: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 1200 }],
    opportunitiesByStrategy: {
      mobile: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 1200 }],
      desktop: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 800 }],
    },
    diagnostics: {
      mobile: [{
        id: "dom-size",
        title: "Avoid an excessive DOM size",
        category: "Performance",
        score: 0,
        scoreDisplayMode: "binary",
        savingsMs: 0,
        savingsBytes: 0,
        actionable: true,
        observedRuns: 5,
        totalObservedRuns: 5,
        eligibleRuns: 5,
        successfulRuns: 5,
        quorum: 3,
        frequency: 1,
        promoted: true,
        confidence: "high",
        savingsLowMs: 0,
        savingsHighMs: 0,
        savingsLowBytes: 0,
        savingsHighBytes: 0,
      }],
    },
    culpritEvidence: {
      mobile: [{ auditId: "dom-size", title: "DOM structure", facts: [{ key: "nodes", label: "DOM nodes", value: 1_240, unit: "count" }], sampleRuns: 4 }],
    },
    nativeElements: nativeElementScan('<div class="w-background-video" data-video-urls="hero.mp4,hero.webm"></div>'),
    kitesurf: {
      schemaVersion: 1,
      engine: "kitesurf",
      status: "available",
      capturedAt: "2026-07-20T10:02:30Z",
      rawReportKey: `run-${jobId}-kitesurf`,
      document: {
        domNodes: 1_240,
        textCharacters: 4_300,
        headings: 8,
        links: 24,
        buttons: 3,
        forms: 1,
        images: 10,
        iframes: 0,
        serializedHtmlCharacters: 92_000,
        htmlRetained: true,
      },
    },
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
  it("stagger-dispatches baseline batches with the minimum trusted PSI sample count", async () => {
    const dataStore = await store();
    await dataStore.updateState((state) => {
      state.pages.push(pendingPage("page-two", "Pricing", "https://webflow.com/pricing", "watching"));
    });
    await enqueueCollectionJob("page", "baseline", { dataStore, id: "batch-one" });
    await enqueueCollectionJob("page-two", "baseline", { dataStore, id: "batch-two" });
    vi.stubEnv("COLLECTOR_URL", "https://collector.example.test/jobs");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    vi.stubEnv("PSI_RUNS", "");
    // Typed so the recorded call tuple exposes the request init.
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ workflowIds: ["batch-one", "batch-two"] }, { status: 202 }));
    vi.stubGlobal("fetch", fetchFn);

    await dispatchCollectionJobs(["batch-one", "batch-two"], dataStore);

    const request = fetchFn.mock.calls[0][1]!;
    expect(JSON.parse(String(request.body))).toMatchObject({
      jobs: [
        { jobId: "batch-one", runs: 3, startDelayMinutes: 0 },
        { jobId: "batch-two", runs: 3, startDelayMinutes: 2 },
      ],
    });
  });

  it("does not enqueue collections for paused pages", async () => {
    const dataStore = await store();
    await dataStore.updateState((state) => {
      state.pages[0].flag = "paused";
    });

    await expect(enqueueCollectionJob("page", "run", { dataStore })).rejects.toThrow("is paused");
    expect((await dataStore.getState()).jobs).toEqual([]);
  });

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
    expect(committed.pages[0].history[0].opportunitiesByStrategy?.desktop?.[0].savingsMs).toBe(800);
    expect(committed.pages[0].history[0].nativeElements).toMatchObject({
      status: "available",
      findings: [expect.objectContaining({ id: "webflow-background-video", count: 1 })],
    });
    expect(committed.pages[0].history[0].kitesurf).toMatchObject({
      engine: "kitesurf",
      status: "available",
      document: { domNodes: 1_240 },
    });
    expect(committed.pages[0].history[0].culpritEvidence?.mobile).toEqual([
      expect.objectContaining({ auditId: "dom-size", facts: [expect.objectContaining({ value: 1_240 })] }),
    ]);
    expect(committed.pages[0].runState).toBeUndefined();
    expect(committed.jobs?.[0].state).toBe("succeeded");
    expect(committed.recs[0].title).toBe("Reduce unused JavaScript");
    expect(committed.recs[0].strategies).toEqual(["mobile", "desktop"]);
    expect(committed.recs[0].webflow).toMatchObject({ culprit: "global-javascript", remediation: "blocked" });
    expect(committed.recs.find((rec) => rec.id === "dom-size")).toMatchObject({
      savings: "Detected",
      strategies: ["mobile"],
      webflow: { culprit: "dom-complexity", remediation: "partial" },
    });
    expect(committed.recs.find((rec) => rec.id === "webflow-background-video")).toMatchObject({
      category: "Native elements",
      savings: "Detected",
      strategies: ["mobile", "desktop"],
    });
    expect(await dataStore.getReport("page", "run-job-one")).not.toBeNull();

    const repeated = await commitCollectionResult(result, {}, dataStore);
    expect(repeated.pages[0].history).toHaveLength(1);
  });

  it("retains an excluded finding's evidence without promoting it again", async () => {
    const dataStore = await store();
    await dataStore.updateState((state) => {
      state.pages[0].nativeElementControls = {
        "webflow-background-video": {
          excluded: { reason: "Not applicable to this site" },
          updatedAt: "2026-08-03T12:00:00.000Z",
        },
      };
    });
    await enqueueCollectionJob("page", "run", { dataStore, id: "excluded-job" });
    await markCollectionJob("excluded-job", "running", { dataStore });

    // Excluding is not deleting: the scan still records the footprint, so the
    // reading a reader comes back to is still there.
    const committed = await commitCollectionResult(collectionResult("excluded-job"), {}, dataStore);
    expect(committed.pages[0].history[0].nativeElements?.findings).toEqual([
      expect.objectContaining({ id: "webflow-background-video" }),
    ]);
    expect(committed.recs.some((rec) => rec.id === "webflow-background-video")).toBe(false);
    expect(committed.recs.some((rec) => rec.id === "unused-javascript")).toBe(true);
  });

  it("creates a field-only recommendation after a durable lab collection", async () => {
    const baseStore = await store();
    const visitorEvidence: CruxPageEvidence[] = [{
      pageId: "page",
      formFactor: "PHONE",
      status: null,
      snapshots: [{
        formFactor: "PHONE",
        scope: "url",
        requestedUrl: "https://webflow.com/enterprise/contact-sales",
        effectiveUrl: "https://webflow.com/enterprise/contact-sales",
        collectionStart: "2026-06-29",
        collectionEnd: "2026-07-26",
        fetchedAt: "2026-07-27T06:15:00.000Z",
        lcpP75Ms: 4_500,
        inpP75Ms: null,
        clsP75: null,
        ttfbP75Ms: null,
        metrics: {},
      }],
    }];
    const dataStore = Object.create(baseStore) as DataStore;
    dataStore.getCruxEvidence = async () => visitorEvidence;
    await enqueueCollectionJob("page", "run", { dataStore, id: "field-only-job" });
    await markCollectionJob("field-only-job", "running", { dataStore });
    const result = collectionResult("field-only-job");
    result.opportunities = [];
    result.opportunitiesByStrategy = { mobile: [], desktop: [] };
    result.measurementContext = {
      mobile: { medianLargestContentfulPaint: 2_000 },
      desktop: { medianLargestContentfulPaint: 1_700 },
    };

    const committed = await commitCollectionResult(result, {}, dataStore);
    expect(committed.recs.find((rec) => rec.id === "crux-field-only-lcp")).toMatchObject({
      source: "crux-field-only",
      strategies: ["mobile"],
      savings: "Field signal",
      fieldSignals: { mobile: { fieldFormatted: "4.5 s", fieldRating: "Poor" } },
    });
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
      const parsed = new URL(url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer shared-secret");
      if (url.endsWith("/jobs/polled-job")) return Response.json({ status: "complete", output: collectionResult("polled-job", 2) });
      if (parsed.pathname.endsWith("/reports/mobile") && parsed.searchParams.get("tenant") === "jobs-test") {
        return Response.json({ strategy: "mobile", raws: [{ id: "mobile-raw" }] });
      }
      if (parsed.pathname.endsWith("/reports/desktop") && parsed.searchParams.get("tenant") === "jobs-test") {
        return Response.json({ strategy: "desktop", raws: [{ id: "desktop-raw" }] });
      }
      if (parsed.pathname.endsWith("/reports") && parsed.searchParams.get("tenant") === "jobs-test" && init?.method === "DELETE") {
        return Response.json({ ok: true });
      }
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
      "https://collector.example.test/jobs/polled-job/reports?tenant=jobs-test",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("preserves retained-device progress while the Workflow sleeps", async () => {
    const dataStore = await store();
    await enqueueCollectionJob("page", "run", { dataStore, id: "waiting-job" });
    await dataStore.updateState((state) => {
      const job = state.jobs![0];
      job.state = "waiting_for_evidence";
      job.completedStrategies = ["desktop"];
      job.strategyAttempts = { mobile: 5, desktop: 3 };
      job.strategyErrors = { mobile: "PSI request failed with HTTP 429" };
      job.nextRetryAt = "2026-08-03T12:00:00.000Z";
      state.pages[0].runState = "waiting_for_evidence";
    });

    const state = await reconcileCollectionJobs({
      dataStore,
      fetchFn: vi.fn(async () => Response.json({ status: "waiting" })) as typeof fetch,
      collectorUrl: "https://collector.example.test/jobs",
      collectorSecret: "shared-secret",
    });

    expect(state.jobs?.[0]).toMatchObject({
      state: "waiting_for_evidence",
      completedStrategies: ["desktop"],
      strategyErrors: { mobile: "PSI request failed with HTTP 429" },
      nextRetryAt: "2026-08-03T12:00:00.000Z",
    });
    expect(state.pages[0].runState).toBe("waiting_for_evidence");
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
