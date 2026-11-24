import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_AUTOMATIONS,
  publicConnection,
  type AutomationSettings,
  type IntegrationConnectionRecord,
  type IntegrationEventRecord,
  type IntegrationSettingsRecord,
  type PublicConnection,
  type TaskLinkRecord,
  type TaskProviderKind,
} from "./types";

/**
 * The integration store: connections, task links, events and settings.
 *
 * Project-scoped, and deliberately separate from `DataStore`/`AppState`. Three
 * reasons, all of them the brief's:
 *
 *   1. AppState is a whole-blob compare-and-swap. A task link written into it
 *      would be overwritten by any concurrent collection write, and a token in
 *      it would be handed to every browser that reads state.
 *   2. These rows change on a different clock from collection. A task is
 *      created and refreshed between runs.
 *   3. The unique index on `(project_id, provider, remediation_key)` is the
 *      duplicate guard. A blob cannot express that.
 *
 * Two adapters: the filesystem one used by `next dev` and tests, and the D1 one
 * used on Cloudflare. `__tests__/store.test.ts` runs the same script against
 * both and compares the results.
 */

const SAFE_PROJECT_ID = /^[A-Za-z0-9._-]+$/;

export class IntegrationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationStoreError";
  }
}

export interface IntegrationStore {
  readonly projectId: string;
  listConnections(): Promise<IntegrationConnectionRecord[]>;
  getConnection(provider: TaskProviderKind): Promise<IntegrationConnectionRecord | null>;
  /** Upsert one connection per provider; returns the stored row (its id is kept). */
  saveConnection(record: IntegrationConnectionRecord): Promise<IntegrationConnectionRecord>;
  deleteConnection(provider: TaskProviderKind): Promise<void>;
  listLinks(): Promise<TaskLinkRecord[]>;
  getLink(provider: TaskProviderKind, remediationKey: string): Promise<TaskLinkRecord | null>;
  /**
   * Insert a link if `(provider, remediationKey)` is free. Never overwrites an
   * existing row: two concurrent creates must not swap external ids under one
   * another. `created` is false when the key was taken, and the returned record
   * is the one already stored.
   */
  createLink(record: TaskLinkRecord): Promise<{ record: TaskLinkRecord; created: boolean }>;
  updateLink(record: TaskLinkRecord): Promise<TaskLinkRecord>;
  deleteLink(provider: TaskProviderKind, remediationKey: string): Promise<void>;
  /**
   * Record an event for idempotency. Returns `created: false` when
   * `(provider, eventId)` was already seen — the caller must then do nothing.
   */
  recordEvent(record: IntegrationEventRecord): Promise<{ record: IntegrationEventRecord; created: boolean }>;
  markEventProcessed(provider: string, eventId: string, processedAt: string, result: string): Promise<void>;
  listEvents(limit?: number): Promise<IntegrationEventRecord[]>;
  getSettings(): Promise<IntegrationSettingsRecord>;
  saveSettings(settings: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord>;
}

/* ── Shared serializable snapshot ───────────────────────────────────────── */

interface IntegrationSnapshot {
  connections: IntegrationConnectionRecord[];
  links: TaskLinkRecord[];
  events: IntegrationEventRecord[];
  settings: IntegrationSettingsRecord | null;
}

function emptySnapshot(): IntegrationSnapshot {
  return { connections: [], links: [], events: [], settings: null };
}

function defaultSettings(projectId: string, now: string): IntegrationSettingsRecord {
  return { projectId, automations: { ...DEFAULT_AUTOMATIONS }, updatedAt: now };
}

/** Normalise what was read, so a hand-edited file cannot invent a shape. */
function normalizeSnapshot(raw: unknown, projectId: string, now: string): IntegrationSnapshot {
  const snapshot = emptySnapshot();
  if (!raw || typeof raw !== "object") return { ...snapshot, settings: defaultSettings(projectId, now) };
  const value = raw as Partial<IntegrationSnapshot>;
  if (Array.isArray(value.connections)) {
    snapshot.connections = value.connections.filter((row) =>
      !!row && typeof row === "object" && row.projectId === projectId && typeof row.provider === "string");
  }
  if (Array.isArray(value.links)) {
    snapshot.links = value.links.filter((row) =>
      !!row && typeof row === "object" && row.projectId === projectId && typeof row.remediationKey === "string");
  }
  if (Array.isArray(value.events)) {
    snapshot.events = value.events.filter((row) =>
      !!row && typeof row === "object" && row.projectId === projectId && typeof row.eventId === "string");
  }
  snapshot.settings = value.settings && typeof value.settings === "object" && value.settings.projectId === projectId
    ? { ...value.settings, automations: normalizeAutomations(value.settings.automations) }
    : defaultSettings(projectId, now);
  return snapshot;
}

function normalizeAutomations(value: unknown): AutomationSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<AutomationSettings>;
  return {
    acceptCreatesTask: raw.acceptCreatesTask === true,
    dismissClosesTask: raw.dismissClosesTask === true,
    reopenCommentsAndReopens: raw.reopenCommentsAndReopens === true,
    taskCompletionOffersMarkFixed: raw.taskCompletionOffersMarkFixed === true,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * One implementation of the semantics, over an abstract read/write snapshot.
 *
 * The filesystem and in-memory adapters share it, which is what makes "same
 * behaviour on both" a property rather than two implementations that happen to
 * agree today.
 */
abstract class SnapshotIntegrationStore implements IntegrationStore {
  readonly projectId: string;

  constructor(projectId: string) {
    if (!projectId || !SAFE_PROJECT_ID.test(projectId)) {
      throw new IntegrationStoreError("IntegrationStore: a valid projectId scope is required");
    }
    this.projectId = projectId;
  }

  protected abstract readSnapshot(): Promise<IntegrationSnapshot>;
  protected abstract writeSnapshot(snapshot: IntegrationSnapshot): Promise<void>;

  private queue: Promise<unknown> = Promise.resolve();

  /** Serialize a read-modify-write, so two requests cannot interleave. */
  private async mutate<T>(fn: (snapshot: IntegrationSnapshot) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const snapshot = await this.readSnapshot();
      const result = await fn(snapshot);
      await this.writeSnapshot(snapshot);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async listConnections(): Promise<IntegrationConnectionRecord[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.connections
      .filter((row) => row.projectId === this.projectId)
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map(clone);
  }

  async getConnection(provider: TaskProviderKind): Promise<IntegrationConnectionRecord | null> {
    const snapshot = await this.readSnapshot();
    const found = snapshot.connections.find((row) => row.projectId === this.projectId && row.provider === provider);
    return found ? clone(found) : null;
  }

  saveConnection(record: IntegrationConnectionRecord): Promise<IntegrationConnectionRecord> {
    return this.mutate((snapshot) => {
      const index = snapshot.connections.findIndex((row) =>
        row.projectId === this.projectId && row.provider === record.provider);
      const stored = index >= 0
        ? { ...record, id: snapshot.connections[index].id, projectId: this.projectId }
        : { ...record, projectId: this.projectId };
      if (index >= 0) snapshot.connections[index] = stored;
      else snapshot.connections.push(stored);
      return clone(stored);
    });
  }

  deleteConnection(provider: TaskProviderKind): Promise<void> {
    return this.mutate((snapshot) => {
      snapshot.connections = snapshot.connections.filter((row) =>
        !(row.projectId === this.projectId && row.provider === provider));
    });
  }

  async listLinks(): Promise<TaskLinkRecord[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.links
      .filter((row) => row.projectId === this.projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async getLink(provider: TaskProviderKind, remediationKey: string): Promise<TaskLinkRecord | null> {
    const snapshot = await this.readSnapshot();
    const found = snapshot.links.find((row) =>
      row.projectId === this.projectId && row.provider === provider && row.remediationKey === remediationKey);
    return found ? clone(found) : null;
  }

  createLink(record: TaskLinkRecord): Promise<{ record: TaskLinkRecord; created: boolean }> {
    return this.mutate((snapshot) => {
      const existing = snapshot.links.find((row) =>
        row.projectId === this.projectId && row.provider === record.provider
        && row.remediationKey === record.remediationKey);
      if (existing) return { record: clone(existing), created: false };
      const stored = { ...record, projectId: this.projectId };
      snapshot.links.push(stored);
      return { record: clone(stored), created: true };
    });
  }

  updateLink(record: TaskLinkRecord): Promise<TaskLinkRecord> {
    return this.mutate((snapshot) => {
      const index = snapshot.links.findIndex((row) => row.id === record.id && row.projectId === this.projectId);
      if (index < 0) throw new IntegrationStoreError(`no task link ${record.id}`);
      snapshot.links[index] = { ...record, projectId: this.projectId };
      return clone(snapshot.links[index]);
    });
  }

  deleteLink(provider: TaskProviderKind, remediationKey: string): Promise<void> {
    return this.mutate((snapshot) => {
      snapshot.links = snapshot.links.filter((row) =>
        !(row.projectId === this.projectId && row.provider === provider && row.remediationKey === remediationKey));
    });
  }

  recordEvent(record: IntegrationEventRecord): Promise<{ record: IntegrationEventRecord; created: boolean }> {
    return this.mutate((snapshot) => {
      const existing = snapshot.events.find((row) =>
        row.projectId === this.projectId && row.provider === record.provider && row.eventId === record.eventId);
      if (existing) return { record: clone(existing), created: false };
      const stored = { ...record, projectId: this.projectId };
      snapshot.events.push(stored);
      return { record: clone(stored), created: true };
    });
  }

  markEventProcessed(provider: string, eventId: string, processedAt: string, result: string): Promise<void> {
    return this.mutate((snapshot) => {
      const row = snapshot.events.find((event) =>
        event.projectId === this.projectId && event.provider === provider && event.eventId === eventId);
      if (row) {
        row.processedAt = processedAt;
        row.result = result;
      }
    });
  }

  async listEvents(limit = 50): Promise<IntegrationEventRecord[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.events
      .filter((row) => row.projectId === this.projectId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit)
      .map(clone);
  }

  async getSettings(): Promise<IntegrationSettingsRecord> {
    const snapshot = await this.readSnapshot();
    return clone(snapshot.settings ?? defaultSettings(this.projectId, new Date(0).toISOString()));
  }

  saveSettings(settings: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord> {
    return this.mutate((snapshot) => {
      const stored = { ...settings, projectId: this.projectId };
      snapshot.settings = stored;
      return clone(stored);
    });
  }
}

/* ── Filesystem adapter ─────────────────────────────────────────────────── */

class FsIntegrationStore extends SnapshotIntegrationStore {
  private readonly file: string;

  constructor(projectId: string, rootDir = process.cwd()) {
    super(projectId);
    this.file = path.join(rootDir, ".data", "integrations", projectId, "integrations.json");
  }

  protected async readSnapshot(): Promise<IntegrationSnapshot> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return normalizeSnapshot(JSON.parse(raw), this.projectId, new Date().toISOString());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...emptySnapshot(), settings: defaultSettings(this.projectId, new Date().toISOString()) };
      }
      throw error;
    }
  }

  protected async writeSnapshot(snapshot: IntegrationSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    await fs.rename(tmp, this.file);
  }
}

export function createFsIntegrationStore(projectId: string, rootDir?: string): IntegrationStore {
  return new FsIntegrationStore(projectId, rootDir);
}

/** In-process adapter for route tests and hosts without durable storage. */
export function createMemoryIntegrationStore(projectId: string, initial?: Partial<IntegrationSnapshot>): IntegrationStore {
  let snapshot: IntegrationSnapshot = {
    ...emptySnapshot(),
    settings: defaultSettings(projectId, new Date(0).toISOString()),
    ...initial,
  };
  return new (class extends SnapshotIntegrationStore {
    protected async readSnapshot(): Promise<IntegrationSnapshot> {
      return clone(snapshot);
    }
    protected async writeSnapshot(next: IntegrationSnapshot): Promise<void> {
      snapshot = clone(next);
    }
  })(projectId);
}

/* ── D1 adapter ─────────────────────────────────────────────────────────── */

interface ConnectionRow {
  id: string;
  project_id: string;
  provider: string;
  workspace_id: string | null;
  workspace_name: string | null;
  default_destination_id: string | null;
  default_destination_name: string | null;
  encrypted_token: string;
  token_nonce: string;
  scopes: string;
  installed_by: string;
  installed_at: string;
  status: string;
  last_error: string | null;
}

interface LinkRow {
  id: string;
  project_id: string;
  remediation_key: string;
  provider: string;
  connection_id: string;
  external_id: string;
  external_url: string | null;
  external_state: string | null;
  assignee: string | null;
  last_synced_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  project_id: string;
  provider: string;
  event_id: string;
  type: string;
  payload_digest: string;
  received_at: string;
  processed_at: string | null;
  result: string | null;
}

interface SettingsRow {
  project_id: string;
  automations_json: string;
  webhook_url: string | null;
  webhook_secret_encrypted: string | null;
  webhook_secret_nonce: string | null;
  api_token_hash: string | null;
  api_token_prefix: string | null;
  api_token_issued_at: string | null;
  api_token_issued_by: string | null;
  updated_at: string;
}

function optional(value: string | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : value;
}

function connectionFromRow(row: ConnectionRow): IntegrationConnectionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider as TaskProviderKind,
    workspaceId: optional(row.workspace_id),
    workspaceName: optional(row.workspace_name),
    defaultDestinationId: optional(row.default_destination_id),
    defaultDestinationName: optional(row.default_destination_name),
    encryptedToken: row.encrypted_token,
    tokenNonce: row.token_nonce,
    scopes: (() => {
      try {
        const value = JSON.parse(row.scopes) as unknown;
        return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
      } catch {
        return [];
      }
    })(),
    installedBy: row.installed_by,
    installedAt: row.installed_at,
    status: row.status as IntegrationConnectionRecord["status"],
    lastError: optional(row.last_error),
  };
}

function linkFromRow(row: LinkRow): TaskLinkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    remediationKey: row.remediation_key,
    provider: row.provider as TaskProviderKind,
    connectionId: row.connection_id,
    externalId: row.external_id,
    externalUrl: optional(row.external_url),
    externalState: optional(row.external_state),
    assignee: optional(row.assignee),
    lastSyncedAt: optional(row.last_synced_at),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventFromRow(row: EventRow): IntegrationEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    eventId: row.event_id,
    type: row.type,
    payloadDigest: row.payload_digest,
    receivedAt: row.received_at,
    processedAt: optional(row.processed_at),
    result: optional(row.result),
  };
}

function settingsFromRow(row: SettingsRow | null, projectId: string): IntegrationSettingsRecord {
  if (!row) return defaultSettings(projectId, new Date(0).toISOString());
  let automations: unknown = {};
  try {
    automations = JSON.parse(row.automations_json);
  } catch {
    automations = {};
  }
  return {
    projectId: row.project_id,
    automations: normalizeAutomations(automations),
    webhookUrl: optional(row.webhook_url),
    webhookSecretEncrypted: optional(row.webhook_secret_encrypted),
    webhookSecretNonce: optional(row.webhook_secret_nonce),
    apiTokenHash: optional(row.api_token_hash),
    apiTokenPrefix: optional(row.api_token_prefix),
    apiTokenIssuedAt: optional(row.api_token_issued_at),
    apiTokenIssuedBy: optional(row.api_token_issued_by),
    updatedAt: row.updated_at,
  };
}

/**
 * The D1 adapter. Every statement is parameterised; no value is interpolated
 * into SQL. Rows are mapped explicitly rather than spread, so a column added to
 * the migration is a visible decision here.
 */
export function createD1IntegrationStore(projectId: string, db: D1Database): IntegrationStore {
  if (!projectId || !SAFE_PROJECT_ID.test(projectId)) {
    throw new IntegrationStoreError("IntegrationStore: a valid projectId scope is required");
  }
  const store: IntegrationStore = {
    projectId,
    async listConnections() {
      const result = await db.prepare(
        "SELECT * FROM integration_connections WHERE project_id = ? ORDER BY provider",
      ).bind(projectId).all<ConnectionRow>();
      return result.results.map(connectionFromRow);
    },
    async getConnection(provider) {
      const row = await db.prepare(
        "SELECT * FROM integration_connections WHERE project_id = ? AND provider = ?",
      ).bind(projectId, provider).first<ConnectionRow>();
      return row ? connectionFromRow(row) : null;
    },
    async saveConnection(record) {
      const existing = await db.prepare(
        "SELECT id FROM integration_connections WHERE project_id = ? AND provider = ?",
      ).bind(projectId, record.provider).first<{ id: string }>();
      const id = existing?.id ?? record.id;
      await db.prepare(
        "INSERT INTO integration_connections " +
        "(id, project_id, provider, workspace_id, workspace_name, default_destination_id, default_destination_name, " +
        "encrypted_token, token_nonce, scopes, installed_by, installed_at, status, last_error) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (project_id, provider) DO UPDATE SET " +
        "workspace_id = excluded.workspace_id, workspace_name = excluded.workspace_name, " +
        "default_destination_id = excluded.default_destination_id, default_destination_name = excluded.default_destination_name, " +
        "encrypted_token = excluded.encrypted_token, token_nonce = excluded.token_nonce, scopes = excluded.scopes, " +
        "installed_by = excluded.installed_by, installed_at = excluded.installed_at, status = excluded.status, " +
        "last_error = excluded.last_error",
      ).bind(
        id, projectId, record.provider, record.workspaceId ?? null, record.workspaceName ?? null,
        record.defaultDestinationId ?? null, record.defaultDestinationName ?? null,
        record.encryptedToken, record.tokenNonce, JSON.stringify(record.scopes),
        record.installedBy, record.installedAt, record.status, record.lastError ?? null,
      ).run();
      const row = await db.prepare(
        "SELECT * FROM integration_connections WHERE project_id = ? AND provider = ?",
      ).bind(projectId, record.provider).first<ConnectionRow>();
      return connectionFromRow(row!);
    },
    async deleteConnection(provider) {
      await db.prepare("DELETE FROM integration_connections WHERE project_id = ? AND provider = ?")
        .bind(projectId, provider).run();
    },
    async listLinks() {
      const result = await db.prepare(
        "SELECT * FROM task_links WHERE project_id = ? ORDER BY created_at",
      ).bind(projectId).all<LinkRow>();
      return result.results.map(linkFromRow);
    },
    async getLink(provider, remediationKey) {
      const row = await db.prepare(
        "SELECT * FROM task_links WHERE project_id = ? AND provider = ? AND remediation_key = ?",
      ).bind(projectId, provider, remediationKey).first<LinkRow>();
      return row ? linkFromRow(row) : null;
    },
    async createLink(record) {
      await db.prepare(
        "INSERT INTO task_links " +
        "(id, project_id, remediation_key, provider, connection_id, external_id, external_url, external_state, " +
        "assignee, last_synced_at, created_by, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id, provider, remediation_key) DO NOTHING",
      ).bind(
        record.id, projectId, record.remediationKey, record.provider, record.connectionId,
        record.externalId, record.externalUrl ?? null, record.externalState ?? null, record.assignee ?? null,
        record.lastSyncedAt ?? null, record.createdBy, record.createdAt, record.updatedAt,
      ).run();
      const row = await db.prepare(
        "SELECT * FROM task_links WHERE project_id = ? AND provider = ? AND remediation_key = ?",
      ).bind(projectId, record.provider, record.remediationKey).first<LinkRow>();
      return { record: linkFromRow(row!), created: row!.id === record.id };
    },
    async updateLink(record) {
      await db.prepare(
        "UPDATE task_links SET external_id = ?, external_url = ?, external_state = ?, assignee = ?, " +
        "last_synced_at = ?, updated_at = ? WHERE project_id = ? AND id = ?",
      ).bind(
        record.externalId, record.externalUrl ?? null, record.externalState ?? null, record.assignee ?? null,
        record.lastSyncedAt ?? null, record.updatedAt, projectId, record.id,
      ).run();
      const row = await db.prepare(
        "SELECT * FROM task_links WHERE project_id = ? AND id = ?",
      ).bind(projectId, record.id).first<LinkRow>();
      if (!row) throw new IntegrationStoreError(`no task link ${record.id}`);
      return linkFromRow(row);
    },
    async deleteLink(provider, remediationKey) {
      await db.prepare("DELETE FROM task_links WHERE project_id = ? AND provider = ? AND remediation_key = ?")
        .bind(projectId, provider, remediationKey).run();
    },
    async recordEvent(record) {
      await db.prepare(
        "INSERT INTO integration_events (id, project_id, provider, event_id, type, payload_digest, received_at, processed_at, result) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id, provider, event_id) DO NOTHING",
      ).bind(
        record.id, projectId, record.provider, record.eventId, record.type, record.payloadDigest,
        record.receivedAt, record.processedAt ?? null, record.result ?? null,
      ).run();
      const row = await db.prepare(
        "SELECT * FROM integration_events WHERE project_id = ? AND provider = ? AND event_id = ?",
      ).bind(projectId, record.provider, record.eventId).first<EventRow>();
      return { record: eventFromRow(row!), created: row!.id === record.id };
    },
    async markEventProcessed(provider, eventId, processedAt, result) {
      await db.prepare(
        "UPDATE integration_events SET processed_at = ?, result = ? WHERE project_id = ? AND provider = ? AND event_id = ?",
      ).bind(processedAt, result, projectId, provider, eventId).run();
    },
    async listEvents(limit = 50) {
      const result = await db.prepare(
        "SELECT * FROM integration_events WHERE project_id = ? ORDER BY received_at DESC LIMIT ?",
      ).bind(projectId, limit).all<EventRow>();
      return result.results.map(eventFromRow);
    },
    async getSettings() {
      const row = await db.prepare("SELECT * FROM integration_settings WHERE project_id = ?")
        .bind(projectId).first<SettingsRow>();
      return settingsFromRow(row, projectId);
    },
    async saveSettings(settings) {
      await db.prepare(
        "INSERT INTO integration_settings " +
        "(project_id, automations_json, webhook_url, webhook_secret_encrypted, webhook_secret_nonce, " +
        "api_token_hash, api_token_prefix, api_token_issued_at, api_token_issued_by, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET " +
        "automations_json = excluded.automations_json, webhook_url = excluded.webhook_url, " +
        "webhook_secret_encrypted = excluded.webhook_secret_encrypted, webhook_secret_nonce = excluded.webhook_secret_nonce, " +
        "api_token_hash = excluded.api_token_hash, api_token_prefix = excluded.api_token_prefix, " +
        "api_token_issued_at = excluded.api_token_issued_at, api_token_issued_by = excluded.api_token_issued_by, " +
        "updated_at = excluded.updated_at",
      ).bind(
        projectId, JSON.stringify(settings.automations), settings.webhookUrl ?? null,
        settings.webhookSecretEncrypted ?? null, settings.webhookSecretNonce ?? null,
        settings.apiTokenHash ?? null, settings.apiTokenPrefix ?? null,
        settings.apiTokenIssuedAt ?? null, settings.apiTokenIssuedBy ?? null, settings.updatedAt,
      ).run();
      const row = await db.prepare("SELECT * FROM integration_settings WHERE project_id = ?")
        .bind(projectId).first<SettingsRow>();
      return settingsFromRow(row, projectId);
    },
  };
  return store;
}

export function publicConnections(records: IntegrationConnectionRecord[]): PublicConnection[] {
  return records.map(publicConnection);
}
