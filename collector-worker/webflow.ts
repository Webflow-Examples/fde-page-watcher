import type {
  WebflowChangeDensity,
  WebflowConnectionStatus,
  WebflowConnectionView,
  WebflowPublishSummary,
  WebflowSyncResult,
} from "../src/lib/webflowTypes";

const WEBFLOW_API_BASE = "https://api.webflow.com/v2";
const MAX_ACTIVITY_PAGES = 5;
const ACTIVITY_PAGE_SIZE = 100;
const TOKEN_VERSION = 1;

export interface WebflowBindings {
  DB: D1Database;
  REPORTS: R2Bucket;
  WEBFLOW_TOKEN_ENCRYPTION_KEY: string;
}

interface WebflowSite {
  id: string;
  displayName: string;
  shortName: string;
  lastPublished?: string | null;
  timeZone?: string | null;
  customDomains?: Array<{ url?: string | null }>;
}

interface WebflowActivityUser {
  id?: string | null;
  displayName?: string | null;
}

interface WebflowActivityEvent {
  id: string;
  createdOn: string;
  lastUpdated?: string | null;
  event: string;
  resourceOperation?: string | null;
  user?: WebflowActivityUser | null;
  resourceId?: string | null;
  resourceName?: string | null;
  newValue?: unknown;
  previousValue?: unknown;
  payload?: unknown;
  source?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

interface WebflowActivityResponse {
  items: WebflowActivityEvent[];
  pagination?: {
    limit?: number;
    offset?: number;
    total?: number;
  };
}

interface WebflowConnectionRow {
  tenant: string;
  site_id: string;
  token_ciphertext: string;
  token_iv: string;
  site_name: string;
  site_slug: string;
  domains_json: string;
  time_zone: string;
  last_published: string | null;
  connected_at: string;
  last_validated_at: string;
  last_synced_at: string | null;
  sync_status: WebflowConnectionView["syncStatus"];
  sync_error: string | null;
}

interface WebflowEventSummaryRow {
  event_type: string;
  resource_operation: string | null;
  actor_name: string | null;
  created_on: string;
  resource_name: string | null;
}

interface WebflowEventCountRow {
  count: number;
}

interface WebflowPublishRow {
  publish_id: string;
  published_at: string;
  previous_published_at: string;
  detected_at: string;
  domains_json: string;
  publisher_actor_name: string | null;
  activity_count: number;
  change_count: number;
  page_count: number;
  actor_count: number;
  resource_count: number;
  change_density: WebflowChangeDensity;
}

interface WebflowPublishAggregateRow {
  activity_count: number;
  change_count: number;
  page_count: number;
  actor_count: number;
  resource_count: number;
}

interface WebflowPublisherRow {
  actor_id: string | null;
  actor_name: string | null;
}

export class WebflowIntegrationError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = "webflow_error",
  ) {
    super(message);
    this.name = "WebflowIntegrationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function validSiteId(siteId: string): boolean {
  return /^[a-f\d]{24}$/i.test(siteId);
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new WebflowIntegrationError(
      "WEBFLOW_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      500,
      "invalid_encryption_key",
    );
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const raw = base64ToBytes(secret);
  if (raw.byteLength !== 32) {
    throw new WebflowIntegrationError(
      "WEBFLOW_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes",
      500,
      "invalid_encryption_key",
    );
  }
  return crypto.subtle.importKey("raw", ownedBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function tokenContext(tenant: string, siteId: string): Uint8Array {
  return new TextEncoder().encode(`${tenant}\0${siteId}\0webflow-site-token-v1`);
}

export async function encryptWebflowToken(
  token: string,
  tenant: string,
  siteId: string,
  secret: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const context = tokenContext(tenant, siteId);
  const plaintext = new TextEncoder().encode(token);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(iv), additionalData: ownedBuffer(context) },
    await encryptionKey(secret),
    ownedBuffer(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptWebflowToken(
  ciphertext: string,
  iv: string,
  tenant: string,
  siteId: string,
  secret: string,
): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedBuffer(base64ToBytes(iv)),
        additionalData: ownedBuffer(tokenContext(tenant, siteId)),
      },
      await encryptionKey(secret),
      ownedBuffer(base64ToBytes(ciphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof WebflowIntegrationError) throw error;
    throw new WebflowIntegrationError(
      "The stored Webflow token could not be decrypted",
      500,
      "token_decryption_failed",
    );
  }
}

async function boundedWebflowJson(response: Response, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WebflowIntegrationError("Webflow returned an unexpectedly large response");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new WebflowIntegrationError("Webflow returned an unexpectedly large response");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new WebflowIntegrationError("Webflow returned invalid JSON");
  }
}

function webflowErrorMessage(status: number, capability: string): string {
  if (status === 401) return "Webflow rejected the site token";
  if (status === 403) return `The site token is missing ${capability} access, or the site is not Enterprise`;
  if (status === 404) return "The Webflow site was not found or is not authorized for this token";
  if (status === 429) return "Webflow rate-limited the connection check; wait a minute and try again";
  return `Webflow ${capability} check failed with status ${status}`;
}

async function webflowRequest(
  token: string,
  path: string,
  capability: string,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(`${WEBFLOW_API_BASE}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new WebflowIntegrationError(
      error instanceof Error && error.name === "TimeoutError"
        ? `Webflow ${capability} check timed out`
        : `Could not reach Webflow for the ${capability} check`,
    );
  }
  if (!response.ok) {
    throw new WebflowIntegrationError(
      webflowErrorMessage(response.status, capability),
      response.status === 429 ? 429 : response.status >= 500 ? 502 : 400,
      `webflow_${response.status}`,
    );
  }
  return boundedWebflowJson(response);
}

function parseSite(value: unknown, expectedSiteId: string): WebflowSite {
  if (!isRecord(value) || value.id !== expectedSiteId) {
    throw new WebflowIntegrationError("Webflow returned an unexpected site response");
  }
  const displayName = stringValue(value.displayName);
  const shortName = stringValue(value.shortName);
  if (!displayName || !shortName) {
    throw new WebflowIntegrationError("Webflow site details are incomplete");
  }
  const customDomains = Array.isArray(value.customDomains)
    ? value.customDomains
      .filter(isRecord)
      .map((domain) => ({ url: stringValue(domain.url) }))
    : [];
  return {
    id: expectedSiteId,
    displayName,
    shortName,
    lastPublished: stringValue(value.lastPublished),
    timeZone: stringValue(value.timeZone),
    customDomains,
  };
}

function parseActivityResponse(value: unknown): WebflowActivityResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new WebflowIntegrationError("Webflow returned an unexpected activity response");
  }
  const items: WebflowActivityEvent[] = [];
  for (const candidate of value.items) {
    if (!isRecord(candidate)) continue;
    const id = stringValue(candidate.id);
    const createdOn = stringValue(candidate.createdOn);
    const event = stringValue(candidate.event);
    if (!id || !createdOn || !event) continue;
    const user = isRecord(candidate.user)
      ? {
          id: stringValue(candidate.user.id),
          displayName: stringValue(candidate.user.displayName),
        }
      : null;
    items.push({
      id,
      createdOn,
      event,
      lastUpdated: stringValue(candidate.lastUpdated),
      resourceOperation: stringValue(candidate.resourceOperation),
      user,
      resourceId: stringValue(candidate.resourceId),
      resourceName: stringValue(candidate.resourceName),
      newValue: candidate.newValue,
      previousValue: candidate.previousValue,
      payload: candidate.payload,
      source: stringValue(candidate.source),
      actorType: stringValue(candidate.actorType),
      actorId: stringValue(candidate.actorId),
      actorName: stringValue(candidate.actorName),
    });
  }
  return { items };
}

async function validateWebflowSite(
  siteId: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<WebflowSite> {
  if (!validSiteId(siteId)) {
    throw new WebflowIntegrationError("Enter a valid 24-character Webflow Site ID", 400, "invalid_site_id");
  }
  if (token.length < 20 || token.length > 2048) {
    throw new WebflowIntegrationError("Enter a valid Webflow site token", 400, "invalid_token");
  }
  const site = parseSite(
    await webflowRequest(token, `/sites/${encodeURIComponent(siteId)}`, "sites:read", fetchFn),
    siteId,
  );
  await Promise.all([
    webflowRequest(token, `/sites/${encodeURIComponent(siteId)}/activity_logs?limit=1&offset=0`, "site_activity:read", fetchFn),
    webflowRequest(token, `/sites/${encodeURIComponent(siteId)}/pages?limit=1&offset=0`, "pages:read", fetchFn),
    webflowRequest(token, `/sites/${encodeURIComponent(siteId)}/assets?limit=1&offset=0`, "assets:read", fetchFn),
    webflowRequest(token, `/sites/${encodeURIComponent(siteId)}/collections`, "cms:read", fetchFn),
  ]);
  return site;
}

function domains(site: WebflowSite): string[] {
  return [...new Set((site.customDomains ?? []).map((domain) => domain.url).filter((value): value is string => !!value))];
}

function safeEventKey(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
}

function eventPayload(event: WebflowActivityEvent): Record<string, unknown> | null {
  return isRecord(event.payload) ? event.payload : null;
}

function eventPageId(event: WebflowActivityEvent): string | null {
  return stringValue(eventPayload(event)?.pageId);
}

function eventBranchId(event: WebflowActivityEvent): string | null {
  return stringValue(eventPayload(event)?.branchId);
}

function eventChangeCount(event: WebflowActivityEvent): number | null {
  const value = eventPayload(event)?.count;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function webflowChangeDensity(changeCount: number): WebflowChangeDensity {
  if (changeCount <= 5) return "small";
  if (changeCount <= 20) return "moderate";
  return "high-change";
}

function publishId(siteId: string, publishedAt: string): string {
  return `${siteId}:${publishedAt}`;
}

function parsedStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function publishSummary(row: WebflowPublishRow): WebflowPublishSummary {
  return {
    id: row.publish_id,
    publishedAt: row.published_at,
    previousPublishedAt: row.previous_published_at,
    detectedAt: row.detected_at,
    publisherName: row.publisher_actor_name,
    domains: parsedStringArray(row.domains_json),
    activityCount: Number(row.activity_count),
    changeCount: Number(row.change_count),
    pageCount: Number(row.page_count),
    actorCount: Number(row.actor_count),
    resourceCount: Number(row.resource_count),
    changeDensity: row.change_density,
  };
}

async function refreshPublishSet(
  bindings: WebflowBindings,
  tenant: string,
  siteId: string,
  previousPublishedAt: string | null,
  publishedAt: string | null,
  publishedDomains: string[],
  detectedAt: string,
): Promise<void> {
  if (!previousPublishedAt || !publishedAt) return;

  let row = await bindings.DB.prepare(
    "SELECT publish_id, published_at, previous_published_at, detected_at, domains_json, " +
    "publisher_actor_name, activity_count, change_count, page_count, actor_count, resource_count, change_density " +
    "FROM webflow_publish_sets WHERE tenant = ? AND site_id = ? AND published_at = ?",
  ).bind(tenant, siteId, publishedAt).first<WebflowPublishRow>();

  if (!row && previousPublishedAt !== publishedAt) {
    const id = publishId(siteId, publishedAt);
    await bindings.DB.prepare(
      "INSERT INTO webflow_publish_sets (" +
      "tenant, publish_id, site_id, published_at, previous_published_at, detected_at, refreshed_at, domains_json, " +
      "activity_count, change_count, page_count, actor_count, resource_count, change_density" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'small') " +
      "ON CONFLICT(tenant, site_id, published_at) DO NOTHING",
    ).bind(
      tenant,
      id,
      siteId,
      publishedAt,
      previousPublishedAt,
      detectedAt,
      detectedAt,
      JSON.stringify(publishedDomains),
    ).run();
    row = await bindings.DB.prepare(
      "SELECT publish_id, published_at, previous_published_at, detected_at, domains_json, " +
      "publisher_actor_name, activity_count, change_count, page_count, actor_count, resource_count, change_density " +
      "FROM webflow_publish_sets WHERE tenant = ? AND site_id = ? AND published_at = ?",
    ).bind(tenant, siteId, publishedAt).first<WebflowPublishRow>();
  }
  if (!row) return;

  await bindings.DB.batch([
    bindings.DB.prepare(
      "DELETE FROM webflow_publish_events WHERE tenant = ? AND publish_id = ?",
    ).bind(tenant, row.publish_id),
    bindings.DB.prepare(
      "INSERT INTO webflow_publish_events (tenant, publish_id, event_id) " +
      "SELECT tenant, ?, event_id FROM webflow_events " +
      "WHERE tenant = ? AND site_id = ? AND created_on > ? AND created_on <= ?",
    ).bind(
      row.publish_id,
      tenant,
      siteId,
      row.previous_published_at,
      row.published_at,
    ),
  ]);

  const [aggregate, publisher] = await Promise.all([
    bindings.DB.prepare(
      "SELECT COUNT(*) AS activity_count, " +
      "COALESCE(SUM(CASE WHEN e.change_count > 0 THEN e.change_count ELSE 1 END), 0) AS change_count, " +
      "COUNT(DISTINCT e.page_id) AS page_count, " +
      "COUNT(DISTINCT CASE WHEN e.actor_name IS NOT NULL THEN COALESCE(e.actor_id, e.actor_name) END) AS actor_count, " +
      "COUNT(DISTINCT CASE WHEN e.resource_id IS NOT NULL OR e.resource_name IS NOT NULL " +
      "THEN COALESCE(e.resource_id, e.resource_name) END) AS resource_count " +
      "FROM webflow_publish_events pe JOIN webflow_events e " +
      "ON e.tenant = pe.tenant AND e.event_id = pe.event_id " +
      "WHERE pe.tenant = ? AND pe.publish_id = ?",
    ).bind(tenant, row.publish_id).first<WebflowPublishAggregateRow>(),
    bindings.DB.prepare(
      "SELECT e.actor_id, e.actor_name FROM webflow_publish_events pe JOIN webflow_events e " +
      "ON e.tenant = pe.tenant AND e.event_id = pe.event_id " +
      "WHERE pe.tenant = ? AND pe.publish_id = ? AND LOWER(e.event_type) LIKE '%publish%' " +
      "AND e.actor_name IS NOT NULL ORDER BY e.created_on DESC LIMIT 1",
    ).bind(tenant, row.publish_id).first<WebflowPublisherRow>(),
  ]);
  const activityCount = Number(aggregate?.activity_count ?? 0);
  const changeCount = Number(aggregate?.change_count ?? 0);
  await bindings.DB.prepare(
    "UPDATE webflow_publish_sets SET refreshed_at = ?, domains_json = ?, publisher_actor_id = ?, " +
    "publisher_actor_name = ?, activity_count = ?, change_count = ?, page_count = ?, actor_count = ?, " +
    "resource_count = ?, change_density = ? WHERE tenant = ? AND publish_id = ?",
  ).bind(
    detectedAt,
    JSON.stringify(publishedDomains),
    publisher?.actor_id ?? null,
    publisher?.actor_name ?? null,
    activityCount,
    changeCount,
    Number(aggregate?.page_count ?? 0),
    Number(aggregate?.actor_count ?? 0),
    Number(aggregate?.resource_count ?? 0),
    webflowChangeDensity(changeCount),
    tenant,
    row.publish_id,
  ).run();
}

async function connectionRow(bindings: WebflowBindings, tenant: string): Promise<WebflowConnectionRow | null> {
  return bindings.DB.prepare(
    "SELECT tenant, site_id, token_ciphertext, token_iv, site_name, site_slug, domains_json, time_zone, " +
    "last_published, connected_at, last_validated_at, last_synced_at, sync_status, sync_error " +
    "FROM webflow_connections WHERE tenant = ?",
  ).bind(tenant).first<WebflowConnectionRow>();
}

export async function getWebflowConnectionStatus(
  bindings: WebflowBindings,
  tenant: string,
): Promise<WebflowConnectionStatus> {
  const row = await connectionRow(bindings, tenant);
  if (!row) return { connected: false };
  const [countResult, latestResult, latestPublishResult] = await Promise.all([
    bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM webflow_events WHERE tenant = ? AND site_id = ?",
    ).bind(tenant, row.site_id).first<WebflowEventCountRow>(),
    bindings.DB.prepare(
      "SELECT event_type, resource_operation, actor_name, created_on, resource_name " +
      "FROM webflow_events WHERE tenant = ? AND site_id = ? ORDER BY created_on DESC LIMIT 1",
    ).bind(tenant, row.site_id).first<WebflowEventSummaryRow>(),
    bindings.DB.prepare(
      "SELECT publish_id, published_at, previous_published_at, detected_at, domains_json, " +
      "publisher_actor_name, activity_count, change_count, page_count, actor_count, resource_count, change_density " +
      "FROM webflow_publish_sets WHERE tenant = ? AND site_id = ? ORDER BY published_at DESC LIMIT 1",
    ).bind(tenant, row.site_id).first<WebflowPublishRow>(),
  ]);
  return {
    connected: true,
    siteId: row.site_id,
    displayName: row.site_name,
    shortName: row.site_slug,
    domains: parsedStringArray(row.domains_json),
    timeZone: row.time_zone,
    lastPublished: row.last_published,
    connectedAt: row.connected_at,
    lastValidatedAt: row.last_validated_at,
    lastSyncedAt: row.last_synced_at,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    activityEventCount: Number(countResult?.count ?? 0),
    latestPublish: latestPublishResult ? publishSummary(latestPublishResult) : null,
    latestActivity: latestResult
      ? {
          event: latestResult.event_type,
          operation: latestResult.resource_operation,
          actorName: latestResult.actor_name,
          createdOn: latestResult.created_on,
          resourceName: latestResult.resource_name,
        }
      : null,
  };
}

export async function connectWebflowSite(
  bindings: WebflowBindings,
  tenant: string,
  input: { siteId: string; token: string },
  fetchFn: typeof fetch = fetch,
): Promise<WebflowConnectionStatus> {
  const siteId = input.siteId.trim().toLowerCase();
  const token = input.token.trim();
  const existing = await connectionRow(bindings, tenant);
  if (existing && existing.site_id !== siteId) {
    throw new WebflowIntegrationError(
      `Disconnect ${existing.site_name} before connecting a different Webflow site`,
      409,
      "site_already_connected",
    );
  }
  const site = await validateWebflowSite(siteId, token, fetchFn);
  const encrypted = await encryptWebflowToken(
    token,
    tenant,
    siteId,
    bindings.WEBFLOW_TOKEN_ENCRYPTION_KEY,
  );
  const now = new Date().toISOString();
  await bindings.DB.prepare(
    "INSERT INTO webflow_connections (" +
    "tenant, site_id, token_ciphertext, token_iv, token_version, site_name, site_slug, domains_json, time_zone, " +
    "last_published, connected_at, last_validated_at, sync_status, updated_at" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?) " +
    "ON CONFLICT(tenant) DO UPDATE SET " +
    "site_id = excluded.site_id, token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, " +
    "token_version = excluded.token_version, site_name = excluded.site_name, site_slug = excluded.site_slug, " +
    "domains_json = excluded.domains_json, time_zone = excluded.time_zone, last_published = excluded.last_published, " +
    "last_validated_at = excluded.last_validated_at, sync_status = 'pending', sync_error = NULL, updated_at = excluded.updated_at",
  ).bind(
    tenant,
    site.id,
    encrypted.ciphertext,
    encrypted.iv,
    TOKEN_VERSION,
    site.displayName,
    site.shortName,
    JSON.stringify(domains(site)),
    site.timeZone ?? "UTC",
    site.lastPublished ?? null,
    existing?.connected_at ?? now,
    now,
    now,
  ).run();
  try {
    await syncWebflowActivity(bindings, tenant, { maxPages: 1, fetchFn });
  } catch {
    // The connection remains valid and exposes the sync failure for a retry.
  }
  return getWebflowConnectionStatus(bindings, tenant);
}

export async function disconnectWebflowSite(bindings: WebflowBindings, tenant: string): Promise<void> {
  await bindings.DB.prepare("DELETE FROM webflow_connections WHERE tenant = ?").bind(tenant).run();
}

async function setSyncFailure(
  bindings: WebflowBindings,
  tenant: string,
  error: unknown,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await bindings.DB.prepare(
    "UPDATE webflow_connections SET sync_status = 'failed', sync_error = ?, updated_at = ? WHERE tenant = ?",
  ).bind(message, new Date().toISOString(), tenant).run();
}

export async function syncWebflowActivity(
  bindings: WebflowBindings,
  tenant: string,
  options: { maxPages?: number; fetchFn?: typeof fetch } = {},
): Promise<WebflowSyncResult> {
  const row = await connectionRow(bindings, tenant);
  if (!row) {
    throw new WebflowIntegrationError("Connect a Webflow site before syncing activity", 404, "not_connected");
  }
  const maxPages = Math.max(1, Math.min(MAX_ACTIVITY_PAGES, options.maxPages ?? MAX_ACTIVITY_PAGES));
  const fetchFn = options.fetchFn ?? fetch;
  await bindings.DB.prepare(
    "UPDATE webflow_connections SET sync_status = 'running', sync_error = NULL, updated_at = ? WHERE tenant = ?",
  ).bind(new Date().toISOString(), tenant).run();
  try {
    const token = await decryptWebflowToken(
      row.token_ciphertext,
      row.token_iv,
      tenant,
      row.site_id,
      bindings.WEBFLOW_TOKEN_ENCRYPTION_KEY,
    );
    const existingRows = await bindings.DB.prepare(
      "SELECT event_id FROM webflow_events WHERE tenant = ? AND site_id = ? ORDER BY created_on DESC LIMIT ?",
    ).bind(tenant, row.site_id, maxPages * ACTIVITY_PAGE_SIZE).all<{ event_id: string }>();
    const existingIds = new Set(existingRows.results.map((event) => event.event_id));
    const events: WebflowActivityEvent[] = [];
    let pages = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const response = parseActivityResponse(await webflowRequest(
        token,
        `/sites/${encodeURIComponent(row.site_id)}/activity_logs?limit=${ACTIVITY_PAGE_SIZE}&offset=${page * ACTIVITY_PAGE_SIZE}`,
        "site_activity:read",
        fetchFn,
      ));
      pages += 1;
      events.push(...response.items);
      if (response.items.length < ACTIVITY_PAGE_SIZE) break;
    }
    const uniqueEvents = [...new Map(events.map((event) => [event.id, event])).values()];
    const newEvents = uniqueEvents.filter((event) => !existingIds.has(event.id));
    const ingestedAt = new Date().toISOString();
    for (let index = 0; index < newEvents.length; index += 25) {
      await Promise.all(newEvents.slice(index, index + 25).map(async (event) => {
        const rawReportKey = `webflow-events/${tenant}/${safeEventKey(event.id)}.json`;
        await bindings.REPORTS.put(rawReportKey, JSON.stringify(event), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            tenant,
            siteId: row.site_id,
            eventId: event.id,
          },
        });
      }));
    }
    const statements = newEvents.map((event) => {
      const rawReportKey = `webflow-events/${tenant}/${safeEventKey(event.id)}.json`;
      return bindings.DB.prepare(
        "INSERT INTO webflow_events (" +
        "tenant, event_id, site_id, created_on, last_updated, event_type, resource_operation, actor_id, actor_name, " +
        "actor_type, resource_id, resource_name, source, page_id, branch_id, change_count, raw_report_key, ingested_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(tenant, event_id) DO NOTHING",
      ).bind(
        tenant,
        event.id,
        row.site_id,
        event.createdOn,
        event.lastUpdated ?? null,
        event.event,
        event.resourceOperation ?? null,
        event.user?.id ?? event.actorId ?? null,
        event.user?.displayName ?? event.actorName ?? null,
        event.actorType ?? null,
        event.resourceId ?? null,
        event.resourceName ?? null,
        event.source ?? null,
        eventPageId(event),
        eventBranchId(event),
        eventChangeCount(event),
        rawReportKey,
        ingestedAt,
      );
    });
    for (let index = 0; index < statements.length; index += 50) {
      await bindings.DB.batch(statements.slice(index, index + 50));
    }
    const site = parseSite(
      await webflowRequest(token, `/sites/${encodeURIComponent(row.site_id)}`, "sites:read", fetchFn),
      row.site_id,
    );
    await refreshPublishSet(
      bindings,
      tenant,
      row.site_id,
      row.last_published,
      site.lastPublished ?? null,
      domains(site),
      ingestedAt,
    );
    await bindings.DB.prepare(
      "UPDATE webflow_connections SET site_name = ?, site_slug = ?, domains_json = ?, time_zone = ?, " +
      "last_published = ?, last_validated_at = ?, last_synced_at = ?, sync_status = 'succeeded', " +
      "sync_error = NULL, updated_at = ? WHERE tenant = ?",
    ).bind(
      site.displayName,
      site.shortName,
      JSON.stringify(domains(site)),
      site.timeZone ?? "UTC",
      site.lastPublished ?? null,
      ingestedAt,
      ingestedAt,
      ingestedAt,
      tenant,
    ).run();
    return {
      ok: true,
      fetched: uniqueEvents.length,
      inserted: newEvents.length,
      pages,
      syncedAt: ingestedAt,
    };
  } catch (error) {
    await setSyncFailure(bindings, tenant, error);
    throw error;
  }
}

export async function syncConfiguredWebflowSite(
  bindings: WebflowBindings,
  tenant: string,
): Promise<WebflowSyncResult | null> {
  if (!(await connectionRow(bindings, tenant))) return null;
  return syncWebflowActivity(bindings, tenant);
}
