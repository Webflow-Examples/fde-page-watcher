/**
 * The stored shapes of a task-tool integration.
 *
 * Kept out of `types.ts` on purpose: `AppState` is one blob behind a whole-blob
 * compare-and-swap, and task links, tokens and sync cursors must not ride in it
 * (DECISIONS.md 7, and the brief for the integration store). These records live
 * in their own tables and their own store, project-scoped.
 *
 * The provider token never leaves the server. `IntegrationConnectionRecord` is
 * the storage shape and names the encrypted fields; `PublicConnection` is the
 * only connection shape that crosses a network or reaches React.
 */

export type TaskProviderKind = "asana" | "linear";

export const TASK_PROVIDERS: readonly TaskProviderKind[] = ["asana", "linear"] as const;

export function isTaskProviderKind(value: unknown): value is TaskProviderKind {
  return typeof value === "string" && (TASK_PROVIDERS as readonly string[]).includes(value);
}

export type ConnectionStatus = "connected" | "error" | "disconnected";

export interface IntegrationConnectionRecord {
  id: string;
  projectId: string;
  provider: TaskProviderKind;
  workspaceId?: string;
  workspaceName?: string;
  defaultDestinationId?: string;
  defaultDestinationName?: string;
  /** AES-256-GCM ciphertext, base64. Never rendered, never returned. */
  encryptedToken: string;
  /** The per-write nonce, base64. Not secret on its own, but never rendered either. */
  tokenNonce: string;
  scopes: string[];
  installedBy: string;
  installedAt: string;
  status: ConnectionStatus;
  lastError?: string;
}

/** A connection as the browser may see it: everything except the token. */
export type PublicConnection = Omit<IntegrationConnectionRecord, "encryptedToken" | "tokenNonce">;

export function publicConnection(record: IntegrationConnectionRecord): PublicConnection {
  // Written out rather than spread-and-omitted, so a token column added to the
  // record cannot reach the browser by default.
  return {
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    workspaceId: record.workspaceId,
    workspaceName: record.workspaceName,
    defaultDestinationId: record.defaultDestinationId,
    defaultDestinationName: record.defaultDestinationName,
    scopes: [...record.scopes],
    installedBy: record.installedBy,
    installedAt: record.installedAt,
    status: record.status,
    lastError: record.lastError,
  };
}

export interface TaskLinkRecord {
  id: string;
  projectId: string;
  /** The case's remediation key — the unit of the work, not the case id. */
  remediationKey: string;
  provider: TaskProviderKind;
  connectionId: string;
  externalId: string;
  externalUrl?: string;
  /**
   * The task tool's own state word, as reported. Deliberately not narrowed into
   * a Page Watch state: it is a reading of another system, and mapping it into
   * the lifecycle is exactly the second writer the boundary forbids.
   */
  externalState?: string;
  assignee?: string;
  lastSyncedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationEventRecord {
  id: string;
  projectId: string;
  /** "asana", "linear", or "page_watch" for the outbound event stream. */
  provider: string;
  /** Deterministic for the fact described, so a retried dispatch is a no-op. */
  eventId: string;
  type: string;
  payloadDigest: string;
  receivedAt: string;
  processedAt?: string;
  result?: string;
}

/**
 * The four named automations. Names, not a rules engine: each is one sentence
 * a person can read, and there is no expression language to learn or to get
 * wrong.
 */
export interface AutomationSettings {
  /** 1. Accept creates a task. */
  acceptCreatesTask: boolean;
  /** 2. Dismiss closes the task with the dismissal reason. */
  dismissClosesTask: boolean;
  /** 3. Reopen comments and reopens the task. */
  reopenCommentsAndReopens: boolean;
  /** 4. Task completion adds a note and offers Mark fixed — never resolves. */
  taskCompletionOffersMarkFixed: boolean;
}

export const DEFAULT_AUTOMATIONS: AutomationSettings = {
  acceptCreatesTask: false,
  dismissClosesTask: false,
  reopenCommentsAndReopens: false,
  taskCompletionOffersMarkFixed: false,
};

export interface IntegrationSettingsRecord {
  projectId: string;
  automations: AutomationSettings;
  /** Outbound signed-event webhook for external automation (Zapier, Make, n8n). */
  webhookUrl?: string;
  webhookSecretEncrypted?: string;
  webhookSecretNonce?: string;
  /** SHA-256 of the project-scoped API token. The token itself is shown once. */
  apiTokenHash?: string;
  apiTokenPrefix?: string;
  apiTokenIssuedAt?: string;
  apiTokenIssuedBy?: string;
  updatedAt: string;
}

/** Settings as the browser may see them: no secret material, prefix only. */
export interface PublicIntegrationSettings {
  projectId: string;
  automations: AutomationSettings;
  webhookUrl?: string;
  webhookConfigured: boolean;
  apiTokenPrefix?: string;
  apiTokenIssuedAt?: string;
  apiTokenIssuedBy?: string;
  updatedAt: string;
}

export function publicSettings(record: IntegrationSettingsRecord): PublicIntegrationSettings {
  return {
    projectId: record.projectId,
    automations: { ...record.automations },
    webhookUrl: record.webhookUrl,
    webhookConfigured: !!record.webhookSecretEncrypted,
    apiTokenPrefix: record.apiTokenPrefix,
    apiTokenIssuedAt: record.apiTokenIssuedAt,
    apiTokenIssuedBy: record.apiTokenIssuedBy,
    updatedAt: record.updatedAt,
  };
}
