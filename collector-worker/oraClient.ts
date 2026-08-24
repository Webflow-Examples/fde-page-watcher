/**
 * Network access to Ora's agent-readiness API.
 *
 * All contract interpretation lives in `src/lib/ora.ts`; this module only moves
 * bytes and enforces operational limits: abort timeouts, bounded response
 * bodies, `Retry-After` handling, capped polling, and an optional bearer token.
 *
 * Every request is made with `?format=audit&include=essentials`, so the
 * application depends on Ora's versioned, allowlisted envelope rather than its
 * internal response shape.
 *
 * A transport, quota, or provider failure is never a site failure. Callers
 * receive a classified outcome and decide what to persist; nothing here writes
 * to storage or mutates a page.
 */

import {
  classifyOraResponse,
  clampOraMaxAgeSeconds,
  normalizeOraTarget,
  oraRetryAfterSeconds,
  oraScanUrl,
  oraScoreChecksUrl,
  oraScoreUrl,
  type OraResponseOutcome,
} from "../src/lib/ora";

/** Ora audit bodies are small; this is a generous ceiling, not a target. */
export const ORA_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export const ORA_REQUEST_TIMEOUT_MS = 30_000;

/** Total time one refresh may spend waiting for a partial analysis to resolve. */
export const ORA_MAX_POLL_MS = 45_000;
export const ORA_POLL_INTERVAL_MS = 5_000;

export interface OraClientOptions {
  /** Removes public scan-family rate limits. Absent is valid and supported. */
  apiKey?: string;
  fetchFn?: typeof fetch;
  /** Injected in tests so polling does not actually sleep. */
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export class OraTransportError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "OraTransportError";
  }
}

async function defaultSleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Read at most `ORA_MAX_RESPONSE_BYTES`, then parse. A body that is too large or
 * not JSON yields null rather than throwing, so the caller still sees the HTTP
 * status and can classify the response.
 */
async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ORA_MAX_RESPONSE_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > ORA_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

async function request(
  url: string,
  init: RequestInit,
  options: OraClientOptions,
): Promise<RawResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORA_REQUEST_TIMEOUT_MS);
  const headers = new Headers({ accept: "application/json", ...init.headers });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  // Sent only when a key is configured; keyless operation is fully supported.
  if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
  try {
    const response = await fetchFn(url, {
      ...init,
      headers,
      signal: controller.signal,
      redirect: "error",
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await boundedJson(response),
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    throw new OraTransportError(
      aborted
        ? `Ora request timed out after ${ORA_REQUEST_TIMEOUT_MS}ms`
        : `Ora request failed: ${error instanceof Error ? error.name : "unknown"}`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

function outcome(raw: RawResponse): OraResponseOutcome {
  return classifyOraResponse({ status: raw.status, headers: raw.headers, body: raw.body });
}

/**
 * Read Ora's stored score without triggering a scan. A cached read consumes no
 * scan quota, so this always runs before any write or scan operation.
 */
export async function getCachedOraAudit(
  origin: string,
  options: OraClientOptions = {},
): Promise<OraResponseOutcome> {
  const { host } = normalizeOraTarget(origin);
  return outcome(await request(oraScoreUrl(host), { method: "GET" }, options));
}

export interface ScanOraOriginOptions extends OraClientOptions {
  /** Page Watch freshness policy, clamped to Ora's documented bounds. */
  maxAgeSeconds?: number;
  /** Bypass the freshness window entirely. Consumes the smaller force budget. */
  force?: boolean;
}

/**
 * Run a full audit for one origin, following a `202` only to the provider's own
 * documented poll URL and only for a bounded total time. A scan still pending
 * when the budget expires is returned as an incomplete result, which is real
 * evidence — not an error.
 */
export async function scanOraOrigin(
  origin: string,
  options: ScanOraOriginOptions = {},
): Promise<{ outcome: OraResponseOutcome; polls: number }> {
  const { host } = normalizeOraTarget(origin);
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const first = outcome(await request(oraScanUrl(), {
    method: "POST",
    body: JSON.stringify({
      url: host,
      maxAgeSeconds: clampOraMaxAgeSeconds(options.maxAgeSeconds),
      ...(options.force ? { force: true } : {}),
    }),
  }, options));

  if (first.kind !== "result" || first.complete) return { outcome: first, polls: 0 };

  const deadline = now() + ORA_MAX_POLL_MS;
  let current = first;
  let polls = 0;
  while (current.kind === "result" && !current.complete && current.pollUrl) {
    if (now() + ORA_POLL_INTERVAL_MS > deadline) break;
    await sleep(ORA_POLL_INTERVAL_MS);
    polls += 1;
    const next = outcome(await request(current.pollUrl, { method: "GET" }, options));
    // A poll that is rate-limited or fails leaves the partial result standing:
    // partial evidence is better than discarding what the scan already scored.
    if (next.kind !== "result") return { outcome: current, polls };
    // Preserve the poll URL so the loop can continue while still unfinished.
    current = next.complete ? next : { ...next, pollUrl: current.pollUrl };
  }
  return { outcome: current, polls };
}

export interface OraCheckOutcome {
  kind: "results";
  contractVersion?: string;
  results: Array<{ id: string; status: string }>;
}

/**
 * Re-run a named set of checks against one origin. Always executes live, so it
 * is only ever called for an explicit post-remediation verification, never on a
 * schedule and never for checks the caller supplied directly.
 */
export async function runOraChecks(
  origin: string,
  checkIds: string[],
  options: OraClientOptions = {},
): Promise<OraResponseOutcome | OraCheckOutcome> {
  const { host } = normalizeOraTarget(origin);
  const unique = [...new Set(checkIds)].filter((id) => typeof id === "string" && id.trim());
  if (unique.length === 0) {
    throw new TypeError("runOraChecks requires at least one check id");
  }
  const raw = await request(oraScoreChecksUrl(), {
    method: "POST",
    body: JSON.stringify({ url: host, checkIds: unique }),
  }, options);

  if (raw.status !== 200) return outcome(raw);
  const body = raw.body as { contractVersion?: unknown; results?: unknown } | null;
  const results = Array.isArray(body?.results) ? body.results : null;
  // A 200 that is not the documented envelope is a contract failure, not a
  // silent empty verification.
  if (!results) {
    return { kind: "provider-error", status: 200, code: "MALFORMED_CHECKS", retryable: false };
  }
  return {
    kind: "results",
    ...(typeof body?.contractVersion === "string" ? { contractVersion: body.contractVersion } : {}),
    results: results.flatMap((entry) => {
      const item = entry as { id?: unknown; status?: unknown };
      return typeof item?.id === "string" && typeof item?.status === "string"
        ? [{ id: item.id, status: item.status }]
        : [];
    }),
  };
}

/** Seconds until the provider will accept another request, when it told us. */
export function oraCooldownSeconds(raw: {
  headers?: Headers;
  body?: unknown;
}): number | undefined {
  return oraRetryAfterSeconds({ headers: raw.headers, body: raw.body ?? null });
}
