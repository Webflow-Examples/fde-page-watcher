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
  await reconcileCollectionJobs({
    dataStore,
    onCommitted: (jobId) => after(() => finalizeCollectionJob(jobId, dataStore).catch((error) => {
      console.error(JSON.stringify({ message: "collection finalization deferred", jobId, error: String(error).slice(0, 500) }));
    })),
  });
  const state = await recoverStaleRuns(dataStore);
  return NextResponse.json({ state });
}
