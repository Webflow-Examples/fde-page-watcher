import { randomUUID } from "node:crypto";
import { remediationKey as remediationKeyOf, type IssueCase } from "../issue-case";
import { issueCasesFrom } from "../issue-cases";
import { ticketMarkdown } from "../fix-ticket";
import { taskMarker, type CreateTaskInput, type ExternalTask, type TaskProvider } from "./provider";
import { CASE_BATCH_LIMIT, previewBulk, type BulkPreview } from "./preview";
import type { IntegrationStore } from "./store";
import type { AppState } from "../types";
import type { IntegrationConnectionRecord, TaskLinkRecord } from "./types";

/**
 * Create, link, refresh and unlink a task — the only writer of task links.
 *
 * The unit is `remediationKey`, never a case id. Two cases that one fix covers
 * are siblings, and siblings share one task: creating a second would ask the
 * person doing the work to finish the same job twice. The unique row in
 * `task_links` is the guard, and the provider-side marker is the second guard
 * for the window between "provider accepted the write" and "we stored the id".
 */

export { CASE_BATCH_LIMIT, previewBulk };
export type { BulkPreview };

export class TaskBatchLimitError extends Error {
  constructor() {
    super(`A batch is capped at ${CASE_BATCH_LIMIT} cases; split the selection.`);
    this.name = "TaskBatchLimitError";
  }
}

export interface CreateTaskOptions {
  projectId: string;
  state: AppState;
  store: IntegrationStore;
  provider: TaskProvider;
  connection: IntegrationConnectionRecord;
  remediationKey: string;
  createdBy: string;
  destinationId?: string;
  appUrl?: string;
  now?: Date;
}

export type CreateTaskOutcome =
  | { status: "created"; link: TaskLinkRecord; assigneeNote?: string }
  | { status: "already_linked"; link: TaskLinkRecord }
  | { status: "skipped"; reason: string };

export function caseForRemediation(state: AppState, key: string): IssueCase | undefined {
  return issueCasesFrom(state).find((issue) => remediationKeyOf(issue) === key);
}

export function caseForId(state: AppState, caseId: string): IssueCase | undefined {
  return issueCasesFrom(state).find((issue) => issue.id === caseId);
}

function pageTitlesOf(state: AppState): Record<string, string> {
  return Object.fromEntries(state.pages.map((page) => [page.id, page.title]));
}

/** Find the task this integration already made, before asking for another. */
export async function ensureTask(provider: TaskProvider, input: CreateTaskInput): Promise<ExternalTask> {
  const existing = await provider.findTaskByMarker(input.destinationId, input.marker);
  if (existing) return existing;
  return provider.createTask(input);
}

export function taskTitle(issue: IssueCase): string {
  return `${issue.id} — ${issue.diagnosis || issue.title}`;
}

export async function createTaskForCase(options: CreateTaskOptions): Promise<CreateTaskOutcome> {
  const existing = await options.store.getLink(options.provider.kind, options.remediationKey);
  if (existing) return { status: "already_linked", link: existing };

  const issue = caseForRemediation(options.state, options.remediationKey);
  if (!issue) return { status: "skipped", reason: "the case is no longer on the board" };
  if (issue.remediation.steps.length === 0) {
    return { status: "skipped", reason: "no plan — add remediation steps first" };
  }

  const destinationId = options.destinationId ?? options.connection.defaultDestinationId;
  if (!destinationId) {
    return { status: "skipped", reason: "no default destination — choose one in Settings" };
  }

  const marker = taskMarker(options.projectId, options.remediationKey);
  const task = await ensureTask(options.provider, {
    destinationId,
    workspaceId: options.connection.workspaceId,
    title: taskTitle(issue),
    // The ticket and the hidden marker. Nothing else crosses the boundary: no
    // evidence ledger, no raw reports, no visitor data.
    body: ticketMarkdown(issue, { pageTitles: pageTitlesOf(options.state), appUrl: options.appUrl }),
    marker,
    ...(issue.owner ? { assigneeEmail: issue.owner } : {}),
  });

  const now = (options.now ?? new Date()).toISOString();
  const { record: link, created } = await options.store.createLink({
    id: `link-${randomUUID()}`,
    projectId: options.projectId,
    remediationKey: options.remediationKey,
    provider: options.provider.kind,
    connectionId: options.connection.id,
    externalId: task.id,
    externalUrl: task.url,
    externalState: task.state,
    ...(task.assignee ? { assignee: task.assignee } : {}),
    lastSyncedAt: now,
    createdBy: options.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  if (!created) return { status: "already_linked", link };

  const assigneeNote = issue.owner && !task.assignee
    ? `No ${options.provider.kind} user matched ${issue.owner}, so the task is unassigned.`
    : undefined;
  return { status: "created", link, ...(assigneeNote ? { assigneeNote } : {}) };
}

const PROVIDER_LABEL = { asana: "Asana", linear: "Linear" } as const;

export interface RefreshedTask {
  link: TaskLinkRecord;
  task: ExternalTask;
  /** A sentence for the case when the task tool reports an ending. Never a state change. */
  note?: string;
  /** True when the case may offer Mark fixed; the caller still checks the registry. */
  completed: boolean;
  canceled: boolean;
}

export async function refreshTaskLink(input: {
  store: IntegrationStore;
  provider: TaskProvider;
  link: TaskLinkRecord;
  now?: Date;
}): Promise<RefreshedTask> {
  const task = await input.provider.getTask(input.link.externalId);
  const at = (input.now ?? new Date()).toISOString();
  const link = await input.store.updateLink({
    ...input.link,
    externalUrl: task.url ?? input.link.externalUrl,
    externalState: task.state,
    ...(task.assignee ? { assignee: task.assignee } : {}),
    lastSyncedAt: at,
    updatedAt: at,
  });
  const label = PROVIDER_LABEL[input.provider.kind];
  let note: string | undefined;
  if (task.completed) {
    note = `Completed in ${label}. That is a signal the change shipped, not a resolution — Mark fixed starts the 2/7/30-day checks.`;
  } else if (task.canceled) {
    note = `Canceled in ${label}. If the work is off, dismiss the case with a reason.`;
  }
  return { link, task, ...(note ? { note } : {}), completed: task.completed, canceled: task.canceled };
}

/**
 * Keep one note per ending, not one per refresh.
 *
 * The event row is the idempotency guard: refreshing a completed task every
 * hour adds one note, not one an hour. `result` is the sentence the case shows.
 */
export async function recordTaskNote(input: {
  store: IntegrationStore;
  link: TaskLinkRecord;
  kind: "completed" | "canceled";
  text: string;
  now?: Date;
}): Promise<boolean> {
  const at = (input.now ?? new Date()).toISOString();
  const { created } = await input.store.recordEvent({
    id: `event-${randomUUID()}`,
    projectId: input.link.projectId,
    provider: input.link.provider,
    eventId: `task-note:${input.link.id}:${input.kind}:${input.link.externalState ?? ""}`,
    type: "task.note",
    payloadDigest: `${input.link.externalId}:${input.kind}:${input.link.externalState ?? ""}`,
    receivedAt: at,
    processedAt: at,
    result: input.text,
  });
  return created;
}

export async function unlinkTask(store: IntegrationStore, provider: TaskProvider["kind"], remediationKey: string): Promise<void> {
  await store.deleteLink(provider, remediationKey);
}

/* ── Bulk ───────────────────────────────────────────────────────────────── */

export interface BulkSelection {
  caseIds: string[];
}

export interface BulkCaseResult {
  caseId: string;
  remediationKey?: string;
  status: "created" | "already_linked" | "skipped" | "failed";
  reason?: string;
  externalUrl?: string;
  externalId?: string;
}

export interface BulkResult {
  results: BulkCaseResult[];
  preview: BulkPreview;
  ok: boolean;
}

export async function bulkCreateTasks(input: {
  projectId: string;
  state: AppState;
  store: IntegrationStore;
  provider: TaskProvider;
  connection: IntegrationConnectionRecord;
  caseIds: readonly string[];
  createdBy: string;
  appUrl?: string;
  now?: Date;
}): Promise<BulkResult> {
  if (input.caseIds.length > CASE_BATCH_LIMIT) throw new TaskBatchLimitError();
  const links = await input.store.listLinks();
  const preview = previewBulk({
    state: input.state,
    links,
    provider: input.provider.kind,
    caseIds: input.caseIds,
  });
  const cases = issueCasesFrom(input.state);
  const byId = new Map(cases.map((issue) => [issue.id, issue]));
  const seen = new Set<string>();
  const results: BulkCaseResult[] = [];

  for (const caseId of input.caseIds) {
    const issue = byId.get(caseId);
    if (!issue) {
      results.push({ caseId, status: "skipped", reason: "the case is no longer on the board" });
      continue;
    }
    const key = remediationKeyOf(issue);
    if (seen.has(key)) {
      results.push({ caseId, remediationKey: key, status: "skipped", reason: "shares a fix with another selected case" });
      continue;
    }
    seen.add(key);
    try {
      const outcome = await createTaskForCase({
        projectId: input.projectId,
        state: input.state,
        store: input.store,
        provider: input.provider,
        connection: input.connection,
        remediationKey: key,
        createdBy: input.createdBy,
        appUrl: input.appUrl,
        now: input.now,
      });
      if (outcome.status === "created") {
        results.push({ caseId, remediationKey: key, status: "created", externalId: outcome.link.externalId, externalUrl: outcome.link.externalUrl });
      } else if (outcome.status === "already_linked") {
        results.push({ caseId, remediationKey: key, status: "already_linked", externalId: outcome.link.externalId, externalUrl: outcome.link.externalUrl });
      } else {
        results.push({ caseId, remediationKey: key, status: "skipped", reason: outcome.reason });
      }
    } catch (error) {
      // Partial success is the contract: one failed item does not roll back the
      // others, because the tasks that were created are already the provider's.
      results.push({ caseId, remediationKey: key, status: "failed", reason: String(error).slice(0, 300) });
    }
  }

  return { results, preview, ok: results.every((result) => result.status !== "failed") };
}
