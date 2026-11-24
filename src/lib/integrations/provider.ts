import type { TaskProviderKind } from "./types";

/**
 * The task-tool contract.
 *
 * Seven operations, no more: list where a task can go, create one, read it,
 * update it, comment on it, close it, reopen it. There is deliberately no
 * `setStatus(PageWatchState)` and no `resolve`: the task tool's lifecycle is its
 * own, and mapping it onto the case lifecycle from this side is the second
 * writer DECISIONS.md 7 forbids. `ExternalTask` carries the provider's state as
 * a string to be shown, never narrowed into a Page Watch state.
 *
 * Every adapter is constructed with an injected `fetch`, so a test server can
 * stand in for Asana or Linear without any claim of live verification.
 */

export interface Destination {
  /** The provider id a task is created in: an Asana project, a Linear project. */
  id: string;
  name: string;
  /** Asana workspace / Linear team. */
  workspaceId: string;
  workspaceName?: string;
}

export interface ProviderUser {
  id: string;
  name: string;
  email?: string;
}

export interface ExternalTask {
  id: string;
  url?: string;
  /** The task tool's own word for where it is. Shown, never mapped. */
  state: string;
  assignee?: string;
  title?: string;
  completed: boolean;
  canceled: boolean;
}

export interface CreateTaskInput {
  destinationId: string;
  title: string;
  /** The ticket markdown. The evidence ledger, raw reports and visitor data never appear here. */
  body: string;
  /** The hidden marker, so a retried create finds the task it already made. */
  marker: string;
  /** The case owner's account email, mapped to a provider user. */
  assigneeEmail?: string;
  workspaceId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  body?: string;
  assigneeEmail?: string;
}

export interface TaskProvider {
  readonly kind: TaskProviderKind;
  listDestinations(): Promise<Destination[]>;
  listUsers(): Promise<ProviderUser[]>;
  createTask(input: CreateTaskInput): Promise<ExternalTask>;
  /** Find a task this integration already created, by the marker in its body. */
  findTaskByMarker(destinationId: string, marker: string): Promise<ExternalTask | null>;
  getTask(id: string): Promise<ExternalTask>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<ExternalTask>;
  comment(id: string, body: string): Promise<void>;
  close(id: string, reason: string): Promise<ExternalTask>;
  reopen(id: string): Promise<ExternalTask>;
}

/**
 * A provider call that failed.
 *
 * `retryable` is derived from the status rather than trusted from the caller:
 * 429 and 5xx are worth another attempt, and a 400 or 401 is not — retrying a
 * bad token five times just makes five bad requests.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly body?: string;

  constructor(message: string, options: { status: number; retryAfterMs?: number; body?: string }) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.body = options.body;
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY: Required<Omit<RetryOptions, "sleep">> = {
  attempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry an idempotent request on 429 and 5xx, with deterministic exponential
 * backoff.
 *
 * Deterministic on purpose: the contract test asserts the delays, and a jittered
 * sequence would make that assertion a statement about the clock. A provider's
 * `Retry-After` wins over the computed delay when it is larger.
 *
 * This retries the CALL, not the creation. A caller that must not duplicate a
 * task checks the marker first on every attempt — see `ensureTask` in
 * `tasks.ts` — because a 503 can arrive after the provider committed the write.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_RETRY.attempts);
  const base = Math.max(1, options.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs);
  const max = Math.max(base, options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs);
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt === attempts - 1) throw error;
      const computed = Math.min(max, base * 2 ** attempt);
      const delay = error.retryAfterMs !== undefined ? Math.max(computed, error.retryAfterMs) : computed;
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * The hidden marker's one spelling.
 *
 * It rides in the task body so a create that was retried after a 5xx can find
 * what the first attempt already made. The remediation key is JSON of the
 * steps, so two characters are escaped to keep the comment a comment and the
 * marker on one line; detection compares against this same string, so escaping
 * cannot make a task unfindable.
 */
export function taskMarker(projectId: string, remediationKey: string): string {
  const safe = remediationKey.replace(/-->/g, "--&gt;").replace(/[\r\n]+/g, " ");
  return `<!-- page-watch:${projectId}:${safe} -->`;
}

export function markerPresent(body: string, marker: string): boolean {
  return body.includes(marker);
}
