import type { CruxPageEvidence } from "./crux";
import type { AppState, CollectionJob, WatchPage } from "./types";

const ACTIVE_STATES = new Set(["queued", "dispatching", "running", "waiting_for_evidence"]);

function pageIsActive(page: WatchPage): boolean {
  return !!page.runState && ACTIVE_STATES.has(page.runState);
}

function jobIsActive(job: CollectionJob): boolean {
  return ACTIVE_STATES.has(job.state);
}

/** Active durable jobs must resume reconciliation after any page load. */
export function hasActiveCollections(state: AppState): boolean {
  return (state.jobs ?? []).some(jobIsActive) || state.pages.some(pageIsActive);
}

export interface CollectionPollerOptions {
  url: string;
  getState: () => AppState;
  onState: (state: AppState) => void;
  onVisitorExperience?: (evidence: CruxPageEvidence[]) => void;
  fetchFn?: typeof fetch;
  intervalMs?: number;
}

export interface CollectionRequestResult {
  state?: AppState;
  queued?: boolean;
  coalesced?: boolean;
  jobId?: string;
}

/** Describe what the server actually did instead of optimistically claiming a new run. */
export function collectionRequestMessage(
  pageTitle: string,
  requestedKind: "run" | "baseline",
  result: CollectionRequestResult,
): string {
  if (result.coalesced || result.queued === false) {
    const job = result.state?.jobs?.find((item) => item.id === result.jobId);
    if (job?.state === "waiting_for_evidence") {
      return `Collection for ${pageTitle} is waiting for evidence and will retry automatically`;
    }
    return `Collection already in progress for ${pageTitle}`;
  }
  return requestedKind === "baseline"
    ? `Baseline queued for ${pageTitle} — collecting in the background…`
    : `Run started for ${pageTitle} — collecting in the background…`;
}

/**
 * Start one immediate, self-terminating reconciliation loop. The caller owns
 * state, so the loop survives route changes as long as the provider remains
 * mounted and also starts from persisted active state after a full refresh.
 */
export function startCollectionPolling(options: CollectionPollerOptions): () => void {
  const fetchFn = options.fetchFn ?? fetch;
  const intervalMs = options.intervalMs ?? 3000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    try {
      const response = await fetchFn(options.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json().catch(() => null)) as {
        state?: AppState;
        visitorExperience?: CruxPageEvidence[];
      } | null;
      if (!stopped && body?.state) options.onState(body.state);
      if (!stopped && body?.visitorExperience) options.onVisitorExperience?.(body.visitorExperience);
    } catch {
      // The durable job remains active. A transient app or collector outage is
      // retried instead of being misreported as a collection failure.
    } finally {
      if (!stopped && hasActiveCollections(options.getState())) {
        timer = setTimeout(poll, intervalMs);
      }
    }
  };

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Build one concise toast when a reconciliation poll settles active work. */
export function collectionSettlementMessage(previous: AppState, next: AppState): string | null {
  const settled = next.pages.flatMap((page) => {
    const before = previous.pages.find((item) => item.id === page.id);
    if (!before || !pageIsActive(before) || pageIsActive(page)) return [];
    const job = (previous.jobs ?? []).find((item) => item.pageId === page.id && jobIsActive(item));
    return [{ page, kind: job?.kind ?? "run" }];
  });

  if (settled.length === 0) return null;
  if (settled.length > 1) {
    const failures = settled.filter(({ page }) => page.runState === "failed").length;
    const completed = settled.length - failures;
    if (failures === 0) return `${completed} collections complete`;
    if (completed === 0) return `${failures} collections failed`;
    return `${completed} collections complete; ${failures} failed`;
  }

  const [{ page, kind }] = settled;
  if (page.runState === "failed") {
    return kind === "baseline"
      ? `Baseline failed: ${page.lastError ?? "see job status"}`
      : `Run failed for ${page.title}: ${page.lastError ?? "see job status"}`;
  }
  return kind === "baseline" ? `Baseline captured for ${page.title}` : `Run complete for ${page.title}`;
}
