import {
  CruxApiError,
  cruxSnapshotStatus,
  hasUsableCruxMetrics,
  latestCruxSnapshot,
  queryCruxHistory,
  selectCruxEvidence,
  type CruxFormFactor,
  type CruxHistoryQuery,
  type CruxPageEvidence,
  type CruxScope,
  type CruxSnapshot,
} from "../src/lib/crux";
import { isPageActivelyMonitored } from "../src/lib/watchCapacity";
import { createFdeStore, type FdeStoreBindings } from "./dataStore";
import { reconcileFieldOnlyRecommendationsInState } from "../src/lib/fieldOnlyRecommendations";

export const CRUX_COLLECTION_CRON = "15 6 * * 2";
export const CRUX_SCHEDULER_STATUS_KEY = "scheduler/crux-latest.json";
export const CRUX_RETENTION_PERIODS = 60;

const FORM_FACTORS: CruxFormFactor[] = ["PHONE", "DESKTOP"];
const MAX_CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

export interface CruxEnvironment extends FdeStoreBindings {
  CRUX_API_KEY: string;
  NIGHTLY_TENANT: string;
}

export interface CruxCollectionResult {
  ok: boolean;
  tenant: string;
  pages: number;
  targets: number;
  available: number;
  partial: number;
  insufficient: number;
  errors: number;
  snapshotsUpserted: number;
}

interface TargetResult {
  status: "available" | "partial" | "insufficient" | "error";
  snapshots: number;
  evidence?: CruxPageEvidence;
}

function rawReportKey(
  tenant: string,
  pageId: string,
  formFactor: CruxFormFactor,
  scope: CruxScope,
  fetchedAt: string,
): string {
  const stamp = fetchedAt.replace(/[:.]/g, "-");
  return `crux/${tenant}/${pageId}/${formFactor}/${stamp}-${scope}.json`;
}

function retryDelay(error: unknown, attempt: number): number {
  if (error instanceof CruxApiError && error.retryAfter) {
    const seconds = Number(error.retryAfter);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1000));
    const date = Date.parse(error.retryAfter);
    if (Number.isFinite(date)) return Math.min(10_000, Math.max(0, date - Date.now()));
  }
  return Math.min(8_000, 1000 * (2 ** attempt));
}

function retryable(error: unknown): boolean {
  if (error instanceof CruxApiError) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError");
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function queryWithRetry(
  request: CruxHistoryQuery,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await queryCruxHistory(request, {
        apiKey,
        fetchFn,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === MAX_ATTEMPTS - 1) throw error;
      await delay(retryDelay(error, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof CruxApiError) {
    return {
      code: error.code ?? `HTTP_${error.status}`,
      message: error.message.slice(0, 300),
    };
  }
  return {
    code: error instanceof Error ? error.name : "UNKNOWN",
    message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  };
}

function snapshotStatement(
  DB: D1Database,
  tenant: string,
  pageId: string,
  snapshot: CruxSnapshot,
  reportKey: string,
): D1PreparedStatement {
  return DB.prepare(
    "INSERT INTO crux_snapshots (" +
      "tenant, page_id, form_factor, scope, requested_url, effective_url, " +
      "collection_start, collection_end, fetched_at, lcp_p75_ms, inp_p75_ms, cls_p75, " +
      "ttfb_p75_ms, metrics_json, raw_report_key" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(tenant, page_id, form_factor, collection_end) DO UPDATE SET " +
      "scope = excluded.scope, requested_url = excluded.requested_url, effective_url = excluded.effective_url, " +
      "collection_start = excluded.collection_start, fetched_at = excluded.fetched_at, " +
      "lcp_p75_ms = excluded.lcp_p75_ms, inp_p75_ms = excluded.inp_p75_ms, cls_p75 = excluded.cls_p75, " +
      "ttfb_p75_ms = excluded.ttfb_p75_ms, metrics_json = excluded.metrics_json, " +
      "raw_report_key = excluded.raw_report_key",
  ).bind(
    tenant,
    pageId,
    snapshot.formFactor,
    snapshot.scope,
    snapshot.requestedUrl,
    snapshot.effectiveUrl,
    snapshot.collectionStart,
    snapshot.collectionEnd,
    snapshot.fetchedAt,
    snapshot.lcpP75Ms,
    snapshot.inpP75Ms,
    snapshot.clsP75,
    snapshot.ttfbP75Ms,
    JSON.stringify({
      metrics: snapshot.metrics,
      urlNormalizationDetails: snapshot.urlNormalizationDetails,
    }),
    reportKey,
  );
}

function statusStatement(
  DB: D1Database,
  input: {
    tenant: string;
    pageId: string;
    formFactor: CruxFormFactor;
    status: TargetResult["status"];
    attemptedAt: string;
    scope?: CruxScope;
    collectionEnd?: string;
    succeededAt?: string;
    errorCode?: string;
    errorMessage?: string;
  },
): D1PreparedStatement {
  return DB.prepare(
    "INSERT INTO crux_status (" +
      "tenant, page_id, form_factor, status, effective_scope, latest_collection_end, " +
      "last_attempted_at, last_succeeded_at, error_code, error_message" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(tenant, page_id, form_factor) DO UPDATE SET " +
      "status = excluded.status, effective_scope = excluded.effective_scope, " +
      "latest_collection_end = COALESCE(excluded.latest_collection_end, crux_status.latest_collection_end), " +
      "last_attempted_at = excluded.last_attempted_at, " +
      "last_succeeded_at = COALESCE(excluded.last_succeeded_at, crux_status.last_succeeded_at), " +
      "error_code = excluded.error_code, error_message = excluded.error_message",
  ).bind(
    input.tenant,
    input.pageId,
    input.formFactor,
    input.status,
    input.scope ?? null,
    input.collectionEnd ?? null,
    input.attemptedAt,
    input.succeededAt ?? null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
  );
}

function retentionStatement(
  DB: D1Database,
  tenant: string,
  pageId: string,
  formFactor: CruxFormFactor,
): D1PreparedStatement {
  return DB.prepare(
    "DELETE FROM crux_snapshots WHERE tenant = ? AND page_id = ? AND form_factor = ? " +
    "AND collection_end NOT IN (" +
      "SELECT collection_end FROM crux_snapshots " +
      "WHERE tenant = ? AND page_id = ? AND form_factor = ? " +
      "ORDER BY collection_end DESC LIMIT ?" +
    ")",
  ).bind(
    tenant,
    pageId,
    formFactor,
    tenant,
    pageId,
    formFactor,
    CRUX_RETENTION_PERIODS,
  );
}

async function persistEvidence(
  env: CruxEnvironment,
  tenant: string,
  pageId: string,
  formFactor: CruxFormFactor,
  requestedUrl: string,
  evidence: Awaited<ReturnType<typeof selectCruxEvidence>>,
  attemptedAt: string,
): Promise<TargetResult> {
  if (!evidence) {
    await env.DB.prepare(
      "INSERT INTO crux_status (" +
        "tenant, page_id, form_factor, status, last_attempted_at, error_code, error_message" +
      ") VALUES (?, ?, ?, 'insufficient', ?, 'NOT_FOUND', 'No usable URL- or origin-level CrUX data') " +
      "ON CONFLICT(tenant, page_id, form_factor) DO UPDATE SET " +
        "status = 'insufficient', effective_scope = NULL, last_attempted_at = excluded.last_attempted_at, " +
        "error_code = 'NOT_FOUND', error_message = 'No usable URL- or origin-level CrUX data'",
    ).bind(tenant, pageId, formFactor, attemptedAt).run();
    return { status: "insufficient", snapshots: 0 };
  }

  const reportKey = rawReportKey(tenant, pageId, formFactor, evidence.scope, attemptedAt);
  await env.REPORTS.put(reportKey, JSON.stringify({
    schemaVersion: 1,
    fetchedAt: attemptedAt,
    request: {
      scope: evidence.scope,
      target: evidence.target,
      requestedUrl,
      formFactor,
    },
    response: evidence.raw,
  }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      tenant,
      pageId,
      formFactor,
      scope: evidence.scope,
    },
  });

  const latest = latestCruxSnapshot(evidence.snapshots);
  if (!latest) throw new TypeError("CrUX response did not contain collection periods");
  const usableSnapshots = evidence.snapshots.filter((snapshot) => hasUsableCruxMetrics(snapshot));
  const latestUsable = latestCruxSnapshot(usableSnapshots);
  if (!latestUsable) throw new TypeError("CrUX response did not contain usable metrics");
  const status = evidence.latestAvailable ? cruxSnapshotStatus(latest) : "insufficient";
  const statements = usableSnapshots.map((snapshot) =>
    snapshotStatement(env.DB, tenant, pageId, snapshot, reportKey));
  statements.push(statusStatement(env.DB, {
    tenant,
    pageId,
    formFactor,
    status,
    attemptedAt,
    scope: evidence.scope,
    collectionEnd: latestUsable.collectionEnd,
    succeededAt: attemptedAt,
    ...(status === "insufficient" ? {
      errorCode: "LATEST_PERIOD_UNAVAILABLE",
      errorMessage: "Historical CrUX data exists, but the latest collection period is unavailable",
    } : {}),
  }));
  statements.push(retentionStatement(env.DB, tenant, pageId, formFactor));
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
  return { status, snapshots: usableSnapshots.length };
}

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Collect weekly, rolling 28-day CrUX evidence independently from PSI jobs. */
export async function collectCruxEvidence(
  env: CruxEnvironment,
  options: {
    fetchFn?: typeof fetch;
    now?: Date;
  } = {},
): Promise<CruxCollectionResult> {
  const tenant = env.NIGHTLY_TENANT || "brand-studio:live";
  const attemptedAt = (options.now ?? new Date()).toISOString();
  const fetchFn = options.fetchFn ?? fetch;
  const state = await createFdeStore(tenant, env).getState();
  const pages = state.pages.filter(isPageActivelyMonitored);
  const targets = pages.flatMap((page) =>
    FORM_FACTORS.map((formFactor) => ({ page, formFactor })));
  const originQueries = new Map<string, Promise<unknown>>();

  const results = await mapConcurrent(targets, MAX_CONCURRENCY, async ({ page, formFactor }) => {
    const query = (request: CruxHistoryQuery): Promise<unknown> => {
      if (request.scope === "url") {
        return queryWithRetry(request, env.CRUX_API_KEY, fetchFn);
      }
      const key = `${request.formFactor}:${request.target}`;
      const existing = originQueries.get(key);
      if (existing) return existing;
      const pending = queryWithRetry(request, env.CRUX_API_KEY, fetchFn);
      originQueries.set(key, pending);
      return pending;
    };
    try {
      const evidence = await selectCruxEvidence(page.url, formFactor, query, attemptedAt);
      const persisted = await persistEvidence(
        env,
        tenant,
        page.id,
        formFactor,
        page.url,
        evidence,
        attemptedAt,
      );
      return {
        ...persisted,
        ...(evidence && persisted.status !== "insufficient" ? {
          evidence: {
            pageId: page.id,
            formFactor,
            status: null,
            snapshots: evidence.snapshots,
          },
        } : {}),
      };
    } catch (error) {
      const safe = safeError(error);
      await statusStatement(env.DB, {
        tenant,
        pageId: page.id,
        formFactor,
        status: "error",
        attemptedAt,
        errorCode: safe.code,
        errorMessage: safe.message,
      }).run();
      console.error(JSON.stringify({
        message: "CrUX target collection failed",
        tenant,
        pageId: page.id,
        formFactor,
        errorCode: safe.code,
        error: safe.message,
      }));
      return { status: "error", snapshots: 0 } satisfies TargetResult;
    }
  });

  const count = (status: TargetResult["status"]) =>
    results.filter((result) => result.status === status).length;
  const freshEvidence = results.flatMap((result) => result.evidence ? [result.evidence] : []);
  const preview = structuredClone(state);
  const previewChanges = reconcileFieldOnlyRecommendationsInState(
    preview,
    freshEvidence,
    new Date(attemptedAt),
  );
  if (previewChanges.created || previewChanges.updated) {
    await createFdeStore(tenant, env).updateState((draft) => {
      reconcileFieldOnlyRecommendationsInState(draft, freshEvidence, new Date(attemptedAt));
    });
  }
  return {
    ok: count("error") === 0,
    tenant,
    pages: pages.length,
    targets: targets.length,
    available: count("available"),
    partial: count("partial"),
    insufficient: count("insufficient"),
    errors: count("error"),
    snapshotsUpserted: results.reduce((sum, result) => sum + result.snapshots, 0),
  };
}
