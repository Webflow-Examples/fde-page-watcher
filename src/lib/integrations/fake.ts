import {
  ProviderError,
  markerPresent,
  withRetry,
  type CreateTaskInput,
  type Destination,
  type ExternalTask,
  type ProviderUser,
  type TaskProvider,
  type UpdateTaskInput,
} from "./provider";
import type { TaskProviderKind } from "./types";

/**
 * A deterministic in-memory task tool.
 *
 * Not a mock of Asana or Linear: a provider in its own right, with the smallest
 * state that makes the contract testable — destinations, users, tasks, and a
 * scriptable failure. The route tests and the UI proof run against this, and
 * `docs/task-integrations.md` says plainly that live provider verification needs
 * real apps and secrets.
 *
 * Failure injection is explicit and counted, never random:
 *
 *   - `before` fails the call without performing it;
 *   - `after` performs the write and THEN throws, which is the case a retry
 *     must survive without duplicating a task.
 */

export type FakeOperation =
  | "listDestinations"
  | "listUsers"
  | "createTask"
  | "findTaskByMarker"
  | "getTask"
  | "updateTask"
  | "comment"
  | "close"
  | "reopen";

export interface FakeFailure {
  operation: FakeOperation;
  status: number;
  /** How many calls fail this way. Default 1. */
  times?: number;
  /** `before` (default) does not perform the write; `after` performs it and then throws. */
  effect?: "before" | "after";
  retryAfterMs?: number;
}

export interface FakeTaskRecord {
  id: string;
  destinationId: string;
  title: string;
  body: string;
  state: string;
  assignee?: string;
  completed: boolean;
  canceled: boolean;
  comments: string[];
}

export interface FakeProviderOptions {
  kind?: TaskProviderKind;
  destinations?: Destination[];
  users?: ProviderUser[];
  failures?: FakeFailure[];
  /** The same retry policy a real adapter uses, so the contract tests one rule. */
  retry?: { sleep?: (ms: number) => Promise<void>; attempts?: number; baseDelayMs?: number };
}

export interface FakeProvider extends TaskProvider {
  readonly tasks: FakeTaskRecord[];
  readonly calls: Array<{ operation: FakeOperation; id?: string }>;
  failNext(failure: FakeFailure): void;
  /** Simulate the provider's own change to a task, as the tool's UI would make. */
  setTaskState(id: string, state: { state?: string; completed?: boolean; canceled?: boolean; assignee?: string }): FakeTaskRecord;
}

const DEFAULT_DESTINATIONS: Destination[] = [
  { id: "dest-engineering", name: "Engineering", workspaceId: "workspace-brand", workspaceName: "Brand Studio" },
  { id: "dest-website", name: "Website", workspaceId: "workspace-brand", workspaceName: "Brand Studio" },
];

const DEFAULT_USERS: ProviderUser[] = [
  { id: "user-rae", name: "Rae", email: "rae@webflow.com" },
  { id: "user-ben", name: "Ben", email: "ben@webflow.com" },
];

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const kind = options.kind ?? "asana";
  const destinations = [...(options.destinations ?? DEFAULT_DESTINATIONS)];
  const users = [...(options.users ?? DEFAULT_USERS)];
  const failures: FakeFailure[] = [...(options.failures ?? [])];
  const tasks: FakeTaskRecord[] = [];
  const calls: Array<{ operation: FakeOperation; id?: string }> = [];
  let counter = 0;

  function inject(operation: FakeOperation): "before" | "after" | null {
    const index = failures.findIndex((failure) => failure.operation === operation && (failure.times ?? 1) > 0);
    if (index < 0) return null;
    const failure = failures[index];
    const effect = failure.effect ?? "before";
    const times = (failure.times ?? 1) - 1;
    if (times <= 0) failures.splice(index, 1);
    else failure.times = times;
    if (effect === "before") {
      throw new ProviderError(`injected ${failure.status} on ${operation}`, {
        status: failure.status,
        retryAfterMs: failure.retryAfterMs,
      });
    }
    // Remembered for the caller: the effect is applied, then this is thrown.
    pendingAfter = { status: failure.status, retryAfterMs: failure.retryAfterMs };
    return "after";
  }

  let pendingAfter: { status: number; retryAfterMs?: number } | null = null;
  function settleAfter() {
    if (!pendingAfter) return;
    const { status, retryAfterMs } = pendingAfter;
    pendingAfter = null;
    throw new ProviderError(`injected ${status} after ${kind} committed the write`, { status, retryAfterMs });
  }

  function record(operation: FakeOperation, id?: string) {
    calls.push({ operation, ...(id ? { id } : {}) });
  }

  function call<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, options.retry ?? {});
  }

  function find(id: string): FakeTaskRecord {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new ProviderError(`no task ${id}`, { status: 404 });
    return task;
  }

  function asExternal(task: FakeTaskRecord): ExternalTask {
    return {
      id: task.id,
      url: `https://fake.${kind}.test/task/${task.id}`,
      state: task.state,
      assignee: task.assignee,
      title: task.title,
      completed: task.completed,
      canceled: task.canceled,
    };
  }

  const provider: FakeProvider = {
    kind,
    tasks,
    calls,
    failNext(failure) {
      failures.push(failure);
    },
    setTaskState(id, patch) {
      const task = find(id);
      if (patch.state !== undefined) task.state = patch.state;
      if (patch.completed !== undefined) task.completed = patch.completed;
      if (patch.canceled !== undefined) task.canceled = patch.canceled;
      if (patch.assignee !== undefined) task.assignee = patch.assignee;
      return task;
    },
    async listDestinations() {
      return call(async () => {
        record("listDestinations");
        inject("listDestinations");
        return destinations.map((destination) => ({ ...destination }));
      });
    },
    async listUsers() {
      return call(async () => {
        record("listUsers");
        inject("listUsers");
        return users.map((user) => ({ ...user }));
      });
    },
    async createTask(input: CreateTaskInput) {
      return call(async () => {
      record("createTask", input.destinationId);
      inject("createTask");
      // Same guard as every real adapter: a retry after a committed write finds
      // the task this integration already made instead of creating a second.
      const already = tasks.find((candidate) =>
        candidate.destinationId === input.destinationId && markerPresent(candidate.body, input.marker));
      if (already) return asExternal(already);
      counter += 1;
      const assignee = input.assigneeEmail
        ? users.find((user) => user.email?.toLowerCase() === input.assigneeEmail!.toLowerCase())
        : undefined;
      const task: FakeTaskRecord = {
        id: `fake-${counter}`,
        destinationId: input.destinationId,
        title: input.title,
        body: input.marker ? `${input.body}\n\n${input.marker}` : input.body,
        state: "open",
        ...(assignee ? { assignee: assignee.id } : {}),
        completed: false,
        canceled: false,
        comments: [],
      };
      tasks.push(task);
      settleAfter();
      return asExternal(task);
      });
    },
    async findTaskByMarker(destinationId: string, marker: string) {
      return call(async () => {
        record("findTaskByMarker", destinationId);
        inject("findTaskByMarker");
        const task = tasks.find((candidate) =>
          candidate.destinationId === destinationId && markerPresent(candidate.body, marker));
        settleAfter();
        return task ? asExternal(task) : null;
      });
    },
    async getTask(id: string) {
      return call(async () => {
        record("getTask", id);
        inject("getTask");
        const external = asExternal(find(id));
        settleAfter();
        return external;
      });
    },
    async updateTask(id: string, patch: UpdateTaskInput) {
      return call(async () => {
      record("updateTask", id);
      inject("updateTask");
      const task = find(id);
      if (patch.title !== undefined) task.title = patch.title;
      if (patch.body !== undefined) task.body = patch.body;
      if (patch.assigneeEmail !== undefined) {
        const assignee = users.find((user) => user.email?.toLowerCase() === patch.assigneeEmail!.toLowerCase());
        if (assignee) task.assignee = assignee.id;
        else delete task.assignee;
      }
      settleAfter();
      return asExternal(task);
      });
    },
    async comment(id: string, body: string) {
      return call(async () => {
        record("comment", id);
        inject("comment");
        find(id).comments.push(body);
        settleAfter();
      });
    },
    async close(id: string, reason: string) {
      return call(async () => {
      record("close", id);
      inject("close");
      const task = find(id);
      task.state = "completed";
      task.completed = true;
      task.canceled = false;
      const note = `Closed from Page Watch — ${reason}`;
      if (!task.comments.includes(note)) task.comments.push(note);
      settleAfter();
      return asExternal(task);
      });
    },
    async reopen(id: string) {
      return call(async () => {
        record("reopen", id);
        inject("reopen");
        const task = find(id);
        task.state = "open";
        task.completed = false;
        task.canceled = false;
        settleAfter();
        return asExternal(task);
      });
    },
  };

  return provider;
}
