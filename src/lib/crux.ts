import { normalizeUrl } from "./psiCore";

export const CRUX_HISTORY_ENDPOINT =
  "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord";

export const CRUX_METRIC_NAMES = [
  "largest_contentful_paint",
  "interaction_to_next_paint",
  "cumulative_layout_shift",
  "experimental_time_to_first_byte",
] as const;

export type CruxMetricName = typeof CRUX_METRIC_NAMES[number];
export type CruxFormFactor = "PHONE" | "DESKTOP";
export type CruxScope = "url" | "origin";

export interface CruxHistogramBin {
  start: number | string | null;
  end?: number | string | null;
  density: number | null;
}

export interface CruxSnapshot {
  formFactor: CruxFormFactor;
  scope: CruxScope;
  requestedUrl: string;
  effectiveUrl: string;
  collectionStart: string;
  collectionEnd: string;
  fetchedAt: string;
  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;
  ttfbP75Ms: number | null;
  metrics: Partial<Record<CruxMetricName, {
    p75: number | string | null;
    histogram: CruxHistogramBin[];
  }>>;
  urlNormalizationDetails?: {
    originalUrl?: string;
    normalizedUrl?: string;
  };
}

export type CruxAvailability = "available" | "partial" | "insufficient" | "error";

export interface CruxEvidenceStatus {
  pageId: string;
  formFactor: CruxFormFactor;
  status: CruxAvailability;
  effectiveScope: CruxScope | null;
  latestCollectionEnd: string | null;
  lastAttemptedAt: string;
  lastSucceededAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CruxPageEvidence {
  pageId: string;
  formFactor: CruxFormFactor;
  status: CruxEvidenceStatus | null;
  snapshots: CruxSnapshot[];
}

export interface CruxSnapshotRow {
  page_id: string;
  form_factor: CruxFormFactor;
  scope: CruxScope;
  requested_url: string;
  effective_url: string;
  collection_start: string;
  collection_end: string;
  fetched_at: string;
  lcp_p75_ms: number | null;
  inp_p75_ms: number | null;
  cls_p75: number | null;
  ttfb_p75_ms: number | null;
  metrics_json: string;
}

export interface CruxStatusRow {
  page_id: string;
  form_factor: CruxFormFactor;
  status: CruxAvailability;
  effective_scope: CruxScope | null;
  latest_collection_end: string | null;
  last_attempted_at: string;
  last_succeeded_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

/** Convert storage rows into the tenant-safe read model consumed by the UI. */
export function cruxEvidenceFromRows(
  snapshotRows: CruxSnapshotRow[],
  statusRows: CruxStatusRow[],
  maxSnapshots = 12,
): CruxPageEvidence[] {
  const evidence = new Map<string, CruxPageEvidence>();
  const keyFor = (pageId: string, formFactor: CruxFormFactor) => `${pageId}:${formFactor}`;
  for (const row of statusRows) {
    evidence.set(keyFor(row.page_id, row.form_factor), {
      pageId: row.page_id,
      formFactor: row.form_factor,
      status: {
        pageId: row.page_id,
        formFactor: row.form_factor,
        status: row.status,
        effectiveScope: row.effective_scope,
        latestCollectionEnd: row.latest_collection_end,
        lastAttemptedAt: row.last_attempted_at,
        lastSucceededAt: row.last_succeeded_at,
        errorCode: row.error_code,
        errorMessage: row.error_message,
      },
      snapshots: [],
    });
  }
  for (const row of snapshotRows) {
    const key = keyFor(row.page_id, row.form_factor);
    const item = evidence.get(key) ?? {
      pageId: row.page_id,
      formFactor: row.form_factor,
      status: null,
      snapshots: [],
    };
    if (item.snapshots.length < maxSnapshots) {
      let metrics: CruxSnapshot["metrics"] = {};
      try {
        metrics = JSON.parse(row.metrics_json) as CruxSnapshot["metrics"];
      } catch {
        // Individual p75 columns remain usable when legacy metrics JSON is corrupt.
      }
      item.snapshots.push({
        formFactor: row.form_factor,
        scope: row.scope,
        requestedUrl: row.requested_url,
        effectiveUrl: row.effective_url,
        collectionStart: row.collection_start,
        collectionEnd: row.collection_end,
        fetchedAt: row.fetched_at,
        lcpP75Ms: row.lcp_p75_ms,
        inpP75Ms: row.inp_p75_ms,
        clsP75: row.cls_p75,
        ttfbP75Ms: row.ttfb_p75_ms,
        metrics,
      });
    }
    evidence.set(key, item);
  }
  return [...evidence.values()].map((item) => ({
    ...item,
    snapshots: [...item.snapshots].sort((a, b) => a.collectionEnd.localeCompare(b.collectionEnd)),
  }));
}

export interface CruxHistoryQuery {
  scope: CruxScope;
  target: string;
  formFactor: CruxFormFactor;
}

export interface CruxSelectedEvidence {
  scope: CruxScope;
  target: string;
  raw: unknown;
  snapshots: CruxSnapshot[];
  latestAvailable: boolean;
}

interface JsonRecord {
  [key: string]: unknown;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rawMetricValue(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function isoDate(value: unknown): string | null {
  const item = record(value);
  const year = finiteNumber(item?.year);
  const month = finiteNumber(item?.month);
  const day = finiteNumber(item?.day);
  if (
    year === null || month === null || day === null
    || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
  ) return null;
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate
    ? null
    : candidate;
}

function expectedEffectiveUrl(key: JsonRecord, scope: CruxScope): string | null {
  return stringValue(key[scope]);
}

function metricAt(
  metrics: JsonRecord,
  name: CruxMetricName,
  index: number,
): { p75: number | string | null; histogram: CruxHistogramBin[] } | null {
  const metric = record(metrics[name]);
  if (!metric) return null;
  const p75 = rawMetricValue(array(record(metric.percentilesTimeseries)?.p75s)[index]);
  const histogram = array(metric.histogramTimeseries).flatMap((candidate) => {
    const bin = record(candidate);
    if (!bin) return [];
    const densities = array(bin.densities);
    return [{
      start: rawMetricValue(bin.start),
      ...(bin.end === undefined ? {} : { end: rawMetricValue(bin.end) }),
      density: finiteNumber(densities[index]),
    }];
  });
  if (p75 === null && histogram.every((bin) => bin.density === null)) return null;
  return { p75, histogram };
}

export function parseCruxHistoryResponse(
  value: unknown,
  options: {
    requestedUrl: string;
    formFactor: CruxFormFactor;
    scope: CruxScope;
    fetchedAt?: string;
  },
): CruxSnapshot[] {
  const root = record(value);
  const responseRecord = record(root?.record);
  const key = record(responseRecord?.key);
  const metrics = record(responseRecord?.metrics);
  if (!root || !responseRecord || !key || !metrics) {
    throw new TypeError("CrUX response is missing its record, key, or metrics");
  }
  if (key.formFactor !== options.formFactor) {
    throw new TypeError("CrUX response form factor does not match the request");
  }
  const effectiveUrl = expectedEffectiveUrl(key, options.scope);
  if (!effectiveUrl) throw new TypeError("CrUX response scope does not match the request");

  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const normalization = record(root.urlNormalizationDetails);
  return array(responseRecord.collectionPeriods).map((period, index) => {
    const item = record(period);
    const collectionStart = isoDate(item?.firstDate);
    const collectionEnd = isoDate(item?.lastDate);
    if (!collectionStart || !collectionEnd) {
      throw new TypeError(`CrUX collection period ${index} is invalid`);
    }
    const normalizedMetrics: CruxSnapshot["metrics"] = {};
    for (const name of CRUX_METRIC_NAMES) {
      const metric = metricAt(metrics, name, index);
      if (metric) normalizedMetrics[name] = metric;
    }
    return {
      formFactor: options.formFactor,
      scope: options.scope,
      requestedUrl: normalizeUrl(options.requestedUrl),
      effectiveUrl,
      collectionStart,
      collectionEnd,
      fetchedAt,
      lcpP75Ms: finiteNumber(normalizedMetrics.largest_contentful_paint?.p75),
      inpP75Ms: finiteNumber(normalizedMetrics.interaction_to_next_paint?.p75),
      clsP75: finiteNumber(normalizedMetrics.cumulative_layout_shift?.p75),
      ttfbP75Ms: finiteNumber(normalizedMetrics.experimental_time_to_first_byte?.p75),
      metrics: normalizedMetrics,
      ...(normalization ? {
        urlNormalizationDetails: {
          originalUrl: stringValue(normalization.originalUrl) ?? undefined,
          normalizedUrl: stringValue(normalization.normalizedUrl) ?? undefined,
        },
      } : {}),
    };
  });
}

export function latestCruxSnapshot(snapshots: CruxSnapshot[]): CruxSnapshot | null {
  return snapshots.reduce<CruxSnapshot | null>(
    (latest, snapshot) => !latest || snapshot.collectionEnd > latest.collectionEnd ? snapshot : latest,
    null,
  );
}

export function hasUsableCruxMetrics(snapshot: CruxSnapshot | null): boolean {
  return !!snapshot && [
    snapshot.lcpP75Ms,
    snapshot.inpP75Ms,
    snapshot.clsP75,
    snapshot.ttfbP75Ms,
  ].some((value) => value !== null);
}

export function cruxSnapshotStatus(snapshot: CruxSnapshot): "available" | "partial" {
  return [
    snapshot.lcpP75Ms,
    snapshot.inpP75Ms,
    snapshot.clsP75,
    snapshot.ttfbP75Ms,
  ].every((value) => value !== null) ? "available" : "partial";
}

export function cruxOrigin(url: string): string {
  return new URL(normalizeUrl(url)).origin;
}

export class CruxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "CruxApiError";
  }
}

async function boundedJson(response: Response, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new RangeError("CrUX response is too large");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError("CrUX response is too large");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function providerError(value: unknown): { code?: string; message?: string } {
  const error = record(record(value)?.error);
  return {
    code: stringValue(error?.status) ?? undefined,
    message: stringValue(error?.message) ?? undefined,
  };
}

export async function queryCruxHistory(
  query: CruxHistoryQuery,
  options: {
    apiKey: string;
    fetchFn?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<unknown> {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(
    `${CRUX_HISTORY_ENDPOINT}?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        [query.scope]: query.target,
        formFactor: query.formFactor,
        metrics: CRUX_METRIC_NAMES,
        collectionPeriodCount: 40,
      }),
      signal: options.signal,
    },
  );
  const json = await boundedJson(response);
  if (!response.ok) {
    const detail = providerError(json);
    throw new CruxApiError(
      `CrUX request failed with HTTP ${response.status}${detail.code ? ` (${detail.code})` : ""}`,
      response.status,
      detail.code,
      response.headers.get("retry-after") ?? undefined,
    );
  }
  return json;
}

export async function selectCruxEvidence(
  requestedUrl: string,
  formFactor: CruxFormFactor,
  query: (request: CruxHistoryQuery) => Promise<unknown>,
  fetchedAt = new Date().toISOString(),
): Promise<CruxSelectedEvidence | null> {
  const normalizedUrl = normalizeUrl(requestedUrl);
  const attempt = async (scope: CruxScope, target: string): Promise<CruxSelectedEvidence | null> => {
    try {
      const raw = await query({ scope, target, formFactor });
      const snapshots = parseCruxHistoryResponse(raw, {
        requestedUrl: normalizedUrl,
        formFactor,
        scope,
        fetchedAt,
      });
      return snapshots.some((snapshot) => hasUsableCruxMetrics(snapshot))
        ? {
            scope,
            target,
            raw,
            snapshots,
            latestAvailable: hasUsableCruxMetrics(latestCruxSnapshot(snapshots)),
          }
        : null;
    } catch (error) {
      if (error instanceof CruxApiError && error.status === 404) return null;
      throw error;
    }
  };

  const pageEvidence = await attempt("url", normalizedUrl);
  if (pageEvidence?.latestAvailable) return pageEvidence;
  const originEvidence = await attempt("origin", cruxOrigin(normalizedUrl));
  if (originEvidence?.latestAvailable) return originEvidence;
  return pageEvidence ?? originEvidence;
}
