import type { AppState, CollectionJobKind } from "./types";
import { dispatchCollectionJob, enqueueCollectionJob, executeLocalCollectionJob } from "./collectionJobs";
import { getEnv } from "./env";

export interface StartCollectionResult {
  state: AppState;
  jobId: string;
  queued: boolean;
  coalesced: boolean;
}

/** Select durable production dispatch or the explicit local-development runner. */
export async function startCollection(
  pageId: string,
  kind: CollectionJobKind,
  scheduleLocal?: (job: () => Promise<void>) => void,
): Promise<StartCollectionResult> {
  const enqueued = await enqueueCollectionJob(pageId, kind);
  if (!enqueued.queued) {
    return { state: enqueued.state, jobId: enqueued.job.id, queued: false, coalesced: true };
  }
  if (getEnv("COLLECTOR_URL")) {
    const state = await dispatchCollectionJob(enqueued.job.id);
    return { state, jobId: enqueued.job.id, queued: true, coalesced: false };
  }
  if (process.env.NODE_ENV !== "production" && scheduleLocal) {
    scheduleLocal(async () => {
      await executeLocalCollectionJob(enqueued.job.id).catch((error) => {
        console.error(`[collector:local] ${enqueued.job.id} failed`, error);
      });
    });
    return { state: enqueued.state, jobId: enqueued.job.id, queued: true, coalesced: false };
  }
  // dispatchCollectionJob records a useful failed state before it throws.
  await dispatchCollectionJob(enqueued.job.id);
  throw new Error("unreachable");
}
