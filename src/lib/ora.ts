/**
 * Pure parsing and normalization for Ora's external agent-readiness audit.
 *
 * Everything here is side-effect free: no fetch, no storage, no scheduling. The
 * collector owns network, retry, and persistence behavior so the contract logic
 * stays unit-testable against fixtures.
 *
 * Only fields documented in Ora's OpenAPI contract (`AuditScanResult` /
 * `AuditScoreResult`, reachable with `?format=audit&include=essentials`) are
 * read. Requests use `format=audit` precisely so this module depends on Ora's
 * versioned, allowlisted envelope rather than its internal response shape.
 *
 * Contract notes that shaped this file, all taken from the published spec:
 *   - Check `status` is `pass | fail | warning | error | pending | na`; there is
 *     no `partial` status. `warning` is the partial reading.
 *   - Tiers are `required | recommended | emerging`, and a check carries two of
 *     them — one in `layers[]`, one in `essentials.checks` — which Ora documents
 *     as deliberately divergent. `bonus` is an orthogonal boolean, not a tier.
 *   - `estScoreGain` (canonical score points) and `essentialsGain` (essentials
 *     points) are explicitly not comparable, so they are never merged.
 *   - `mcpAuthRequired` means "could not evaluate", not "failed everything".
 */

import { isBlockedAddress } from "./pageTitle";
import type {
  ExternalAgentAuditAvailability,
  ExternalAgentAuditSnapshot,
  ExternalAgentCheckResult,
  ExternalAgentEssentials,
  ExternalAgentFinding,
  ExternalAgentScoreBucket,
  ExternalAgentTier,
} from "./agentAudit";

export const ORA_ORIGIN = "https://ora.ai";
export const ORA_SCAN_PATH = "/api/scan";
export const ORA_SCAN_CHECKS_PATH = "/api/scan/checks";

/**
 * Ora versions its audit envelope with SemVer and documents that only a major
 * bump removes, renames, or redefines a stable field. Pinning the major keeps
 * additive minors working while a genuine envelope break fails loudly.
 */
export const ORA_AUDIT_CONTRACT_MAJOR = 1;

/** The contract this module was written and fixture-tested against. */
export const ORA_AUDIT_CONTRACT_VERSION = "1.20.1";

/** Documented server-side clamp for the freshness window, in seconds. */
export const ORA_MIN_MAX_AGE_SECONDS = 3_600;
export const ORA_MAX_MAX_AGE_SECONDS = 86_400;

/** Page Watch freshness policy: an audit under a day old is fresh enough. */
export const ORA_DEFAULT_MAX_AGE_SECONDS = 86_400;

/** Bounds on provider-controlled text copied into the compact D1 summary. */
export const ORA_MAX_CHECK_ID_LENGTH = 128;
export const ORA_MAX_NAME_LENGTH = 200;
export const ORA_MAX_DETAILS_LENGTH = 400;
export const ORA_MAX_RECOMMENDATION_LENGTH = 400;
export const ORA_MAX_APPLICABILITY_LENGTH = 300;
export const ORA_MAX_FINDINGS = 200;
export const ORA_MAX_PENDING_CHECKS = 200;
export const ORA_MAX_ESSENTIALS_ISSUES = 200;

/** A target Page Watch refuses to hand to an external scanner. */
export type OraTargetRejection =
  | "invalid-url"
  | "unsupported-scheme"
  | "credentials-present"
  | "private-host";

export class OraTargetError extends Error {
  constructor(readonly code: OraTargetRejection, message: string) {
    super(message);
    this.name = "OraTargetError";
  }
}

export type OraContractFailure =
  | "not-an-object"
  | "missing-contract-version"
  | "contract-major-mismatch"
  | "unexpected-source"
  | "missing-domain"
  | "domain-mismatch"
  | "missing-score"
  | "invalid-scanned-at"
  | "missing-layers";

export class OraContractError extends Error {
  constructor(readonly code: OraContractFailure, message: string) {
    super(message);
    this.name = "OraContractError";
  }
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

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Reduce a watched page URL to the public origin Ora will be asked about.
 * Query strings, fragments, credentials, and paths are dropped before the
 * origin is formed, and private/loopback targets are refused outright so a
 * rejection happens before any outbound request is possible.
 */
export function normalizeOraTarget(input: string): { origin: string; host: string } {
  const candidate = typeof input === "string" ? input.trim() : "";
  if (!candidate) throw new OraTargetError("invalid-url", "An origin is required");

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    throw new OraTargetError("invalid-url", "The target is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OraTargetError("unsupported-scheme", "Only http and https targets can be audited");
  }
  if (url.username || url.password) {
    throw new OraTargetError("credentials-present", "Credential-bearing URLs cannot be audited");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host
    || host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".lan")
    || isBlockedAddress(host)
  ) {
    throw new OraTargetError("private-host", "Private and local targets cannot be audited");
  }

  return { origin: url.origin, host };
}

/** True when a target is safe to submit, without throwing. */
export function isAuditableOraTarget(input: string): boolean {
  try {
    normalizeOraTarget(input);
    return true;
  } catch {
    return false;
  }
}

/** Clamp a Page Watch freshness policy into Ora's documented bounds. */
export function clampOraMaxAgeSeconds(seconds: number | undefined): number {
  const requested = finiteNumber(seconds) ?? ORA_DEFAULT_MAX_AGE_SECONDS;
  return Math.min(
    ORA_MAX_MAX_AGE_SECONDS,
    Math.max(ORA_MIN_MAX_AGE_SECONDS, Math.round(requested)),
  );
}

/** Build the audit-shaped scan URL. Query order is fixed so tests can assert it. */
export function oraScanUrl(): string {
  return `${ORA_ORIGIN}${ORA_SCAN_PATH}?format=audit&include=essentials`;
}

/** Build the audit-shaped cached-score URL used for a read-before-scan. */
export function oraScoreUrl(domain: string): string {
  return `${ORA_ORIGIN}/api/score/${encodeURIComponent(domain)}?format=audit&include=essentials`;
}

/** The only route a `202` may direct polling to. */
export const ORA_SCORE_PATH_PREFIX = "/api/score/";

/**
 * Resolve a `202` `Location` header against Ora's origin. Refuses anything
 * pointing off the provider, and anything outside the documented score route,
 * so a surprising `Location` cannot redirect polling somewhere unintended.
 */
export function oraPollUrl(location: string | null | undefined): string | null {
  if (typeof location !== "string" || !location.trim()) return null;
  try {
    const resolved = new URL(location, ORA_ORIGIN);
    if (resolved.origin !== ORA_ORIGIN) return null;
    if (!resolved.pathname.startsWith(ORA_SCORE_PATH_PREFIX)) return null;
    resolved.searchParams.set("format", "audit");
    resolved.searchParams.set("include", "essentials");
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Ora check status -> provider-neutral result. Unknown statuses stay unavailable. */
export function oraCheckResult(status: unknown): ExternalAgentCheckResult {
  switch (typeof status === "string" ? status.trim().toLowerCase() : "") {
    case "pass":
      return "pass";
    case "warning":
      return "partial";
    case "fail":
      return "failed";
    case "na":
      return "not-applicable";
    // `error` is a provider-side failure and `pending` is an unfinished check.
    // Both mean "no determination", and neither may be read as a site failure.
    default:
      return "unavailable";
  }
}

/** Ora tier -> provider-neutral tier. `bonus` is a separate boolean, not a tier. */
export function oraTier(tier: unknown): ExternalAgentTier {
  switch (typeof tier === "string" ? tier.trim().toLowerCase() : "") {
    case "required":
      return "essential";
    case "recommended":
      return "recommended";
    case "emerging":
      return "emerging";
    default:
      return "unclassified";
  }
}

/**
 * Crosswalk from stable Ora check ids to Page Watch issue families.
 *
 * Every id below was confirmed present in Ora's published check catalog
 * (`GET /api/checks`). Only clear semantic equivalents are mapped; the other
 * ~108 catalog checks stay provider-specific and surface under Ora's own name
 * rather than being guessed into a Page Watch family.
 */
export const ORA_CHECK_ISSUE_KEYS: Readonly<Record<string, string>> = {
  "robots-ai-policy-quality": "agent-discoverability:robots",
  "robots-agent-user-policy": "agent-discoverability:robots",
  sitemap: "agent-discoverability:sitemap",
  "sitemap-lastmod": "agent-discoverability:sitemap",
  "markdown-negotiation": "agent-content:markdown",
  "markdown-negotiation-vary": "agent-content:markdown",
  "content-no-js": "agent-content:no-js",
  "agent-friendly-404": "agent-http:recovery",
  "openapi-spec": "agent-api:openapi",
  "json-error-responses": "agent-api:errors",
  "api-error-model": "agent-api:errors",
  "scoped-permissions": "agent-auth:scopes",
  "mcp-server": "agent-mcp:discovery",
  "mcp-well-known-discovery": "agent-mcp:discovery",
  "mcp-resource-listing": "agent-mcp:resources",
  "mcp-resource-quality": "agent-mcp:resources",
  "rate-limit-headers": "agent-api:rate-limits",
};

/**
 * Page Watch issue family for a provider check, or undefined when unmapped.
 * Own-property only, so a provider id that collides with an `Object.prototype`
 * member cannot resolve to an inherited value.
 */
export function oraIssueKeyForCheck(providerCheckId: string): string | undefined {
  return Object.hasOwn(ORA_CHECK_ISSUE_KEYS, providerCheckId)
    ? ORA_CHECK_ISSUE_KEYS[providerCheckId]
    : undefined;
}

function scoreBucket(value: unknown): ExternalAgentScoreBucket | null {
  const bucket = record(value);
  if (!bucket) return null;
  const earned = finiteNumber(bucket.earned);
  const available = finiteNumber(bucket.available);
  const passing = finiteNumber(bucket.passing);
  const total = finiteNumber(bucket.total);
  return earned === null || available === null || passing === null || total === null
    ? null
    : { earned, available, passing, total };
}

interface EssentialsCheckEntry {
  tier: ExternalAgentTier;
  bonus?: boolean;
  fraction?: number;
  essentialsGain?: number;
  recommendation?: string;
}

function essentialsCheckEntries(essentials: JsonRecord | null): Map<string, EssentialsCheckEntry> {
  const entries = new Map<string, EssentialsCheckEntry>();
  const checks = record(essentials?.checks);
  if (!checks) return entries;
  for (const [id, value] of Object.entries(checks)) {
    const entry = record(value);
    if (!entry) continue;
    const bonus = boolean(entry.bonus);
    const fraction = finiteNumber(entry.fraction);
    const gain = finiteNumber(entry.essentialsGain);
    const recommendation = text(entry.recommendation, ORA_MAX_RECOMMENDATION_LENGTH);
    entries.set(id, {
      tier: oraTier(entry.tier),
      ...(bonus === null ? {} : { bonus }),
      ...(fraction === null ? {} : { fraction }),
      ...(gain === null ? {} : { essentialsGain: gain }),
      ...(recommendation ? { recommendation } : {}),
    });
  }
  return entries;
}

function normalizedEssentials(essentials: JsonRecord | null): ExternalAgentEssentials | undefined {
  if (!essentials) return undefined;
  const essential = scoreBucket(essentials.required);
  const recommended = scoreBucket(essentials.recommended);
  const label = text(essentials.label, ORA_MAX_NAME_LENGTH);
  // The essentials reading is only meaningful with both budgets and its copy.
  if (!essential || !recommended || !label) return undefined;
  return {
    score: finiteNumber(essentials.score),
    label,
    essential,
    recommended,
    bonusPoints: finiteNumber(essentials.bonusPoints) ?? 0,
    issues: array(essentials.issues)
      .flatMap((id) => {
        const value = text(id, ORA_MAX_CHECK_ID_LENGTH);
        return value ? [value] : [];
      })
      .slice(0, ORA_MAX_ESSENTIALS_ISSUES),
  };
}

function normalizedFindings(
  layers: unknown[],
  essentials: Map<string, EssentialsCheckEntry>,
): ExternalAgentFinding[] {
  const findings: ExternalAgentFinding[] = [];
  const seen = new Set<string>();

  for (const layerValue of layers) {
    const layer = record(layerValue);
    if (!layer) continue;
    const category = text(layer.id, ORA_MAX_NAME_LENGTH);

    for (const checkValue of array(layer.checks)) {
      if (findings.length >= ORA_MAX_FINDINGS) return findings;
      const check = record(checkValue);
      if (!check) continue;
      const providerCheckId = text(check.id, ORA_MAX_CHECK_ID_LENGTH);
      const name = text(check.name, ORA_MAX_NAME_LENGTH);
      // Ids are the routing key; a reading without one cannot be acted on.
      if (!providerCheckId || !name) continue;

      // A multi-MCP scan can report the same check id per MCP server. The
      // compact summary keeps the first reading; every occurrence stays in the
      // raw R2 report.
      const mcpKind = text(check.mcpKind, ORA_MAX_NAME_LENGTH);
      const dedupeKey = mcpKind ? `${providerCheckId}:${mcpKind}` : providerCheckId;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const essentialsEntry = essentials.get(providerCheckId);
      const auditTier = oraTier(check.tier);
      const details = text(check.details, ORA_MAX_DETAILS_LENGTH);
      // Ora documents that an essentials recommendation is present only where
      // it overrides Ora's own copy, so it wins when supplied.
      const recommendation = essentialsEntry?.recommendation
        ?? text(check.recommendation, ORA_MAX_RECOMMENDATION_LENGTH);
      const applicability = text(check.naReason, ORA_MAX_APPLICABILITY_LENGTH);
      const maturity = text(check.maturity, ORA_MAX_NAME_LENGTH);
      const specUrl = text(check.specUrl, 500);
      const bonus = boolean(check.bonus);
      const estScoreGain = finiteNumber(check.estScoreGain);
      const issueKey = oraIssueKeyForCheck(providerCheckId);

      findings.push({
        provider: "ora",
        providerCheckId,
        name,
        ...(category ? { category } : {}),
        tier: essentialsEntry?.tier ?? auditTier,
        auditTier,
        ...(essentialsEntry ? { essentialsTier: essentialsEntry.tier } : {}),
        ...(bonus === null ? {} : { bonus }),
        ...(essentialsEntry?.bonus === undefined ? {} : { essentialsBonus: essentialsEntry.bonus }),
        result: oraCheckResult(check.status),
        providerStatus: text(check.status, 40) ?? "unknown",
        ...(details ? { details } : {}),
        ...(recommendation ? { recommendation } : {}),
        ...(applicability ? { applicability } : {}),
        ...(maturity ? { maturity } : {}),
        ...(specUrl ? { specUrl } : {}),
        ...(estScoreGain === null ? {} : { estScoreGain }),
        ...(essentialsEntry?.essentialsGain === undefined
          ? {}
          : { essentialsGain: essentialsEntry.essentialsGain }),
        ...(essentialsEntry?.fraction === undefined ? {} : { fraction: essentialsEntry.fraction }),
        ...(issueKey ? { issueKey } : {}),
      });
    }
  }
  return findings;
}

/**
 * A response `domain` is Ora's normalized (often apex) form of what we asked
 * about, so an exact match is the wrong test. Accept either direction of the
 * suffix relationship and reject only an unrelated host.
 */
export function oraDomainMatchesHost(domain: string, host: string): boolean {
  const left = domain.trim().toLowerCase().replace(/\.$/, "");
  const right = host.trim().toLowerCase().replace(/\.$/, "");
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function assertContractVersion(value: unknown): string {
  const version = text(value, 40);
  if (!version) {
    throw new OraContractError(
      "missing-contract-version",
      "Ora audit response is missing contractVersion; the audit format was not returned",
    );
  }
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major !== ORA_AUDIT_CONTRACT_MAJOR) {
    throw new OraContractError(
      "contract-major-mismatch",
      `Ora audit contract ${version} is outside the supported major ${ORA_AUDIT_CONTRACT_MAJOR}`,
    );
  }
  return version;
}

export interface ParseOraAuditOptions {
  /** Page Watch's normalized origin; becomes the storage key. */
  origin: string;
  /** The target submitted to Ora. Defaults to `origin`. */
  target?: string;
  /** R2 key holding the untruncated provider payload. */
  rawReportKey: string;
  fetchedAt?: string;
  /**
   * Set when the transport already knows the analysis is unfinished, e.g. a
   * `202`. A complete-looking body cannot upgrade this back to `available`.
   */
  forcePartial?: boolean;
}

/**
 * Normalize a documented Ora audit payload into a provider-neutral snapshot.
 * Throws `OraContractError` on anything that is not recognizably the audit
 * envelope, so a malformed or non-audit body can never be persisted as a real
 * reading.
 */
export function parseOraAuditResponse(
  value: unknown,
  options: ParseOraAuditOptions,
): ExternalAgentAuditSnapshot {
  const root = record(value);
  if (!root) {
    throw new OraContractError("not-an-object", "Ora audit response is not a JSON object");
  }
  const contractVersion = assertContractVersion(root.contractVersion);

  // `source` is a required enum of exactly "ora.ai"; when present it is a cheap
  // identity assertion that we are reading an Ora envelope.
  const source = text(root.source, 40);
  if (source && source !== "ora.ai") {
    throw new OraContractError("unexpected-source", `Unexpected audit source "${source}"`);
  }

  const domain = text(root.domain, ORA_MAX_NAME_LENGTH);
  if (!domain) {
    throw new OraContractError("missing-domain", "Ora audit response is missing domain");
  }
  const { host } = normalizeOraTarget(options.origin);
  if (!oraDomainMatchesHost(domain, host)) {
    throw new OraContractError(
      "domain-mismatch",
      "Ora audit response describes a different domain than the requested origin",
    );
  }

  const scannedAt = isoTimestamp(root.scannedAt);
  if (!scannedAt) {
    throw new OraContractError("invalid-scanned-at", "Ora audit response has no usable scannedAt");
  }

  if (!Array.isArray(root.layers)) {
    throw new OraContractError("missing-layers", "Ora audit response is missing layers");
  }

  const rawScore = finiteNumber(root.score);
  if (rawScore === null) {
    throw new OraContractError("missing-score", "Ora audit response is missing a numeric score");
  }
  // An MCP-family scan that short-circuited on a credential-demanding handshake
  // reports score 0 with empty layers. That means "could not evaluate", so the
  // score is withheld rather than presented as a real zero.
  const score = root.mcpAuthRequired === true ? null : rawScore;

  const essentials = record(root.essentials);
  const analysisStatus = text(root.analysisStatus, 40);
  const pendingChecks = array(root.pendingChecks)
    .flatMap((id) => {
      const item = text(id, ORA_MAX_CHECK_ID_LENGTH);
      return item ? [item] : [];
    })
    .slice(0, ORA_MAX_PENDING_CHECKS);
  const complete = !options.forcePartial
    && analysisStatus !== "partial"
    && analysisStatus !== "stuck"
    && pendingChecks.length === 0;

  const grade = text(root.grade, 40);
  const reportUrl = text(root.url, 500);
  const resultAgeSeconds = finiteNumber(root.resultAgeSeconds);
  const essentialsReading = normalizedEssentials(essentials);

  return {
    schemaVersion: 1,
    contractVersion,
    provider: "ora",
    origin: options.origin,
    target: options.target ?? options.origin,
    status: complete ? "available" : "partial",
    scannedAt,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    score,
    ...(grade ? { grade } : {}),
    ...(essentialsReading ? { essentials: essentialsReading } : {}),
    findings: normalizedFindings(root.layers, essentialsCheckEntries(essentials)),
    ...(reportUrl ? { reportUrl } : {}),
    rawReportKey: options.rawReportKey,
    ...(pendingChecks.length ? { pendingChecks } : {}),
    ...(root.servedFromCache === true ? { servedFromCache: true } : {}),
    ...(resultAgeSeconds === null ? {} : { resultAgeSeconds }),
  };
}

export type OraResponseOutcome =
  /** A usable audit body. `complete` is false for a `202` or an unfinished scan. */
  | { kind: "result"; complete: boolean; body: unknown; pollUrl?: string }
  /** Ora holds no cached score for the domain yet. */
  | { kind: "not-scanned"; domain?: string }
  | { kind: "rate-limited"; retryAfterSeconds?: number; code?: string; message?: string }
  /** Page Watch sent something Ora refused. Not a site failure. */
  | { kind: "invalid-request"; code?: string; message?: string }
  | { kind: "provider-error"; status: number; code?: string; message?: string; retryable: boolean };

export interface OraHttpResponseInput {
  status: number;
  /** `Headers`, or any case-insensitive-enough plain record. */
  headers?: Headers | Record<string, string | null | undefined>;
  /** Already-parsed JSON body, or null when the body was absent or unreadable. */
  body: unknown;
}

function headerValue(
  headers: OraHttpResponseInput["headers"],
  name: string,
): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const entries = headers as Record<string, string | null | undefined>;
  const match = Object.keys(entries).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? entries[match] ?? null : null;
}

/**
 * Seconds to wait before retrying. Prefers the `Retry-After` header (documented
 * as integer seconds, but an HTTP date is also legal), then the `retry_after_ms`
 * field Ora returns on a durable-quota denial.
 */
export function oraRetryAfterSeconds(
  input: Pick<OraHttpResponseInput, "headers" | "body">,
  now = Date.now(),
): number | undefined {
  const header = headerValue(input.headers, "retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, Math.round((date - now) / 1000));
  }
  const milliseconds = finiteNumber(record(input.body)?.retry_after_ms);
  return milliseconds === null ? undefined : Math.max(0, Math.round(milliseconds / 1000));
}

function providerError(body: unknown): { code?: string; message?: string } {
  const error = record(body);
  const code = text(error?.code, 80);
  // `error` is the house envelope's always-present human-readable field.
  const message = text(error?.message, 300) ?? text(error?.error, 300);
  return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

/**
 * Classify an Ora HTTP response without touching the network. Transport and
 * quota outcomes are kept strictly separate from site check outcomes so a
 * provider failure can never read as a site failure.
 */
export function classifyOraResponse(input: OraHttpResponseInput): OraResponseOutcome {
  const { status } = input;

  if (status === 200 || status === 202) {
    const body = record(input.body);
    const analysisStatus = text(body?.analysisStatus, 40);
    const pending = array(body?.pendingChecks).length > 0;
    const complete = status === 200
      && analysisStatus !== "partial"
      && analysisStatus !== "stuck"
      && !pending;
    const pollUrl = oraPollUrl(headerValue(input.headers, "location"));
    return {
      kind: "result",
      complete,
      body: input.body,
      ...(pollUrl ? { pollUrl } : {}),
    };
  }

  if (status === 404) {
    const body = record(input.body);
    const domain = text(body?.domain, ORA_MAX_NAME_LENGTH);
    // A 404 that is not the documented not-scanned envelope is a routing fault.
    if (text(body?.code, 80) === "DOMAIN_NOT_SCANNED" || domain) {
      return { kind: "not-scanned", ...(domain ? { domain } : {}) };
    }
    return { kind: "provider-error", status, ...providerError(input.body), retryable: false };
  }

  if (status === 429) {
    const retryAfterSeconds = oraRetryAfterSeconds(input);
    return {
      kind: "rate-limited",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      ...providerError(input.body),
    };
  }

  if (status === 400 || status === 401 || status === 403 || status === 422) {
    return { kind: "invalid-request", ...providerError(input.body) };
  }

  return {
    kind: "provider-error",
    status,
    ...providerError(input.body),
    retryable: status >= 500 || status === 408,
  };
}

/** Provider-operation state for an outcome. Never describes the site itself. */
export function oraAvailabilityFromOutcome(
  outcome: OraResponseOutcome,
): ExternalAgentAuditAvailability {
  switch (outcome.kind) {
    case "result":
      return outcome.complete ? "available" : "pending";
    case "not-scanned":
      return "not-found";
    case "rate-limited":
      return "rate-limited";
    case "invalid-request":
      return "error";
    default:
      return "unavailable";
  }
}

/** Stable, filesystem-safe fragment identifying an origin in an R2 key. */
export async function oraOriginKeyFragment(origin: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(origin));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
