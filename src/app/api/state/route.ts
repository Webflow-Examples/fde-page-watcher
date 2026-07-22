import { NextResponse, after } from "next/server";
import { finalizeCollectionJob, reconcileCollectionJobs } from "@/lib/collectionJobs";
import { recoverStaleRuns } from "@/lib/mutations";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KV read model: latest snapshots per strategy, baselines, watchlist config,
// and the recommendation lifecycle (REQ-005). All access is tenant-scoped.
//
// Read-only. Mutations go through targeted domain endpoints (/api/pages,
// /api/recs, /api/pages/[id]/*) which read-modify-write server-side, so a
// stale client can never overwrite data collected by a concurrent nightly run
// (audit High #2). The client polls this endpoint for the authoritative state.

export async function GET() {
  const dataStore = getStore();
  await reconcileCollectionJobs({ dataStore });
  const recovered = await recoverStaleRuns(dataStore);
  const now = new Date();
  const ready = (recovered.jobs ?? []).filter((job) => {
    if (job.state !== "succeeded" || (job.enrichedAt && job.notifiedAt)) return false;
    return !job.finalizationStartedAt || now.getTime() - Date.parse(job.finalizationStartedAt) > 10 * 60 * 1000;
  }).slice(0, 4);
  const claimed: string[] = [];
  const state = ready.length === 0 ? recovered : await dataStore.updateState((draft) => {
    for (const candidate of ready) {
      const job = (draft.jobs ?? []).find((item) => item.id === candidate.id);
      if (!job || job.state !== "succeeded" || (job.enrichedAt && job.notifiedAt)) continue;
      if (job.finalizationStartedAt && now.getTime() - Date.parse(job.finalizationStartedAt) <= 10 * 60 * 1000) continue;
      job.finalizationStartedAt = now.toISOString();
      claimed.push(job.id);
    }
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
  return NextResponse.json({ state });
}
