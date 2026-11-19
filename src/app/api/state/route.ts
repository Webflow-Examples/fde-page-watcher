import { NextResponse, after } from "next/server";
import { finalizeCollectionJob, reconcileCollectionJobs } from "@/lib/collectionJobs";
import { recoverStaleRuns } from "@/lib/mutations";
import { isProjectAccessError, projectStore } from "@/lib/projects";
import type { DataStore } from "@/lib/store";
import { PROJECT_SELECTION_COOKIE, projectSelectionCookieOptions } from "@/lib/projectSelection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KV read model: latest snapshots per strategy, baselines, watchlist config,
// and the recommendation lifecycle (REQ-005). All access is tenant-scoped.
//
// Read-only. Mutations go through targeted domain endpoints (/api/pages,
// /api/recs, /api/pages/[id]/*) which read-modify-write server-side, so a
// stale client can never overwrite data collected by a concurrent nightly run
// (audit High #2). The client polls this endpoint for the authoritative state.

export async function GET(request: Request) {
  let dataStore: DataStore;
  try {
    dataStore = await projectStore(request);
  } catch (error) {
    if (isProjectAccessError(error)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    throw error;
  }
  /**
   * Reading a project must not depend on its housekeeping.
   *
   * The app shell loads the same state with a plain `getState()` and no
   * reconciliation, which is how a project can render while this endpoint
   * fails. Both steps below write the state, and a write that loses a race or
   * hits a read-only tenant is a reason to skip the maintenance, not a reason
   * to make the project unreadable. Each failure is logged and the read
   * continues from the freshest state that could be obtained.
   */
  const housekeepingFailed = (step: string, error: unknown) => {
    console.error(JSON.stringify({
      message: "state housekeeping failed",
      step,
      error: String(error).slice(0, 500),
    }));
  };
  const reconciled = await reconcileCollectionJobs({ dataStore }).catch((error) => {
    housekeepingFailed("reconcile", error);
    return null;
  });
  const recovered = await recoverStaleRuns(dataStore).catch(async (error) => {
    housekeepingFailed("recover", error);
    // A read that still works is better than a 500; one that does not is a
    // real storage failure and is allowed to reach the caller.
    return reconciled ?? await dataStore.getState();
  });
  const now = new Date();
  const ready = (recovered.jobs ?? []).filter((job) => {
    if (job.state !== "succeeded" || (job.enrichedAt && job.notifiedAt)) return false;
    return !job.finalizationStartedAt || now.getTime() - Date.parse(job.finalizationStartedAt) > 10 * 60 * 1000;
  }).slice(0, 4);
  const claimed: string[] = [];
  const claimReady = () => dataStore.updateState((draft) => {
    for (const candidate of ready) {
      const job = (draft.jobs ?? []).find((item) => item.id === candidate.id);
      if (!job || job.state !== "succeeded" || (job.enrichedAt && job.notifiedAt)) continue;
      if (job.finalizationStartedAt && now.getTime() - Date.parse(job.finalizationStartedAt) <= 10 * 60 * 1000) continue;
      job.finalizationStartedAt = now.toISOString();
      claimed.push(job.id);
    }
  });
  const state = ready.length === 0 ? recovered : await claimReady().catch((error) => {
    // Nothing was claimed for certain, so finalization waits for the next read.
    housekeepingFailed("claim", error);
    claimed.length = 0;
    return recovered;
  });
  for (const jobId of claimed) {
    after(async () => {
      try {
        await finalizeCollectionJob(jobId, dataStore);
      } catch (error) {
        console.error(JSON.stringify({ message: "collection finalization deferred", jobId, error: String(error).slice(0, 500) }));
      } finally {
        await dataStore.updateState((draft) => {
          const job = (draft.jobs ?? []).find((item) => item.id === jobId);
          if (job) delete job.finalizationStartedAt;
        }).catch(() => undefined);
      }
    });
  }
  const visitorExperience = await dataStore.getCruxEvidence().catch(() => []);
  // Origin-scoped external evidence travels beside the state, never inside it,
  // so provider readings cannot be written back through a state mutation.
  const externalAgentAudits = await dataStore.getExternalAgentAudits().catch(() => []);
  const response = NextResponse.json({ state, visitorExperience, externalAgentAudits });
  const requestedProjectId = new URL(request.url).searchParams.get("project");
  if (requestedProjectId) {
    response.cookies.set(PROJECT_SELECTION_COOKIE, requestedProjectId, projectSelectionCookieOptions());
  }
  return response;
}
