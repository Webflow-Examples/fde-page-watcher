import { NextResponse, after } from "next/server";
import { evaluateCronAccess } from "@/lib/access";
import { getEnv } from "@/lib/env";
import type { DataStore } from "@/lib/store";
import { dispatchCollectionJobs, enqueueCollectionJob, finalizeCollectionJob, reconcileCollectionJobs } from "@/lib/collectionJobs";
import { runNightly } from "@/lib/collector";
import { isPageActivelyMonitored } from "@/lib/watchCapacity";
import { dailyDigestCohortId, ensureDailyDigest } from "@/lib/dailyDigest";
import { activeProjectStores } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

async function dispatchProjectNightly(projectId: string, dataStore: DataStore) {
  const projectState = await dataStore.getState();
  if (projectState.projectArchivedAt) {
    return { projectId, ok: true, skipped: "project-archived", queued: 0, coalesced: 0, failed: [] };
  }
  if (!getEnv("COLLECTOR_URL") && process.env.NODE_ENV !== "production") {
    return { projectId, ok: true, local: true, ...await runNightly({ dataStore }) };
  }
  const snapshot = await reconcileCollectionJobs({
    dataStore,
    onCommitted: (jobId) => after(() => finalizeCollectionJob(jobId, dataStore).catch((error) => {
      console.error(JSON.stringify({ message: "nightly finalization deferred", projectId, jobId, error: String(error).slice(0, 500) }));
    })),
  });
  const pages = snapshot.pages
    .filter(isPageActivelyMonitored)
    .sort((a, b) => (a.flag === "priority" ? 0 : 1) - (b.flag === "priority" ? 0 : 1));
  const now = new Date();
  const cohortId = dailyDigestCohortId(snapshot, now);
  await dataStore.updateState((draft) => {
    ensureDailyDigest(draft, cohortId, pages.map((page) => page.id), now);
  });
  const jobIds: string[] = [];
  let coalesced = 0;
  for (const page of pages) {
    const result = await enqueueCollectionJob(page.id, "nightly", { dataStore, cohortId });
    if (result.queued) jobIds.push(result.job.id);
    else coalesced += 1;
  }
  await dispatchCollectionJobs(jobIds, dataStore);
  return { projectId, ok: true, queued: jobIds.length, coalesced, failed: [] };
}

/**
 * Nightly dispatcher. Long-running collection is owned by durable Workflows;
 * this scheduled endpoint only reserves and dispatches one job per page.
 */
export async function POST(req: Request) {
  const access = evaluateCronAccess(req.headers.get("authorization"), {
    secret: getEnv("CRON_SECRET"),
  });
  if (!access.allowed) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  try {
    const scopes = await activeProjectStores();
    const projects = [];
    for (const scope of scopes) {
      try {
        projects.push(await dispatchProjectNightly(scope.projectId, scope.dataStore));
      } catch (error) {
        projects.push({ projectId: scope.projectId, ok: false, error: String(error).slice(0, 500) });
      }
    }
    return NextResponse.json({ ok: projects.every((project) => project.ok), projects }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
