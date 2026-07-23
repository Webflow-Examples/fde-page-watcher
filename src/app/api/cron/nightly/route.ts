import { NextResponse, after } from "next/server";
import { evaluateCronAccess } from "@/lib/access";
import { getEnv } from "@/lib/env";
import { getStore } from "@/lib/store";
import { dispatchCollectionJobs, enqueueCollectionJob, finalizeCollectionJob, reconcileCollectionJobs } from "@/lib/collectionJobs";
import { runNightly } from "@/lib/collector";
import { isPageActivelyMonitored } from "@/lib/watchCapacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

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
    if (!getEnv("COLLECTOR_URL") && process.env.NODE_ENV !== "production") {
      const result = await runNightly();
      return NextResponse.json({ ok: true, local: true, ...result });
    }
    const dataStore = getStore();
    const snapshot = await reconcileCollectionJobs({
      dataStore,
      onCommitted: (jobId) => after(() => finalizeCollectionJob(jobId, dataStore).catch((error) => {
        console.error(JSON.stringify({ message: "nightly finalization deferred", jobId, error: String(error).slice(0, 500) }));
      })),
    });
    const pages = snapshot.pages
      .filter(isPageActivelyMonitored)
      .sort((a, b) => (a.flag === "priority" ? 0 : 1) - (b.flag === "priority" ? 0 : 1));
    const jobIds: string[] = [];
    let coalesced = 0;
    for (const page of pages) {
      const result = await enqueueCollectionJob(page.id, "nightly", { dataStore });
      if (result.queued) jobIds.push(result.job.id);
      else coalesced += 1;
    }
    await dispatchCollectionJobs(jobIds, dataStore);
    return NextResponse.json({ ok: true, queued: jobIds.length, coalesced, failed: [] }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
