import { describe, expect, it } from "vitest";
import type { TaskProvider } from "../provider";
import type { TaskProviderKind } from "../types";
import { createFakeProvider } from "../fake";
import { createAsanaProvider } from "../asana";
import { createLinearProvider } from "../linear";
import { fakeAsanaServer, fakeLinearServer } from "./fake-servers";

/**
 * The contract every task tool must satisfy.
 *
 * Run against the deterministic fake provider, an Asana HTTP fake and a Linear
 * GraphQL fake. That is a test of the adapter's wiring, not live verification:
 * no real Asana or Linear app or token is involved, and `docs/task-integrations.md`
 * says which credentials live verification still needs.
 */

interface TaskShape {
  id: string;
  completed: boolean;
  canceled: boolean;
  comments: string[];
}

interface Harness {
  label: "fake" | "asana" | "linear";
  kind: TaskProviderKind;
  provider: TaskProvider;
  destinationId: string;
  workspaceId: string;
  tasks: () => TaskShape[];
  failCreate: (options: { status: number; times?: number; afterWrite?: boolean; retryAfterSeconds?: number }) => void;
}

interface HarnessOptions {
  sleep?: (ms: number) => Promise<void>;
}

const MARKER = "<!-- page-watch:brand-studio:steps:direct:[\"do the thing\"] -->";

function harnesses(options: HarnessOptions = {}): Array<[string, () => Harness]> {
  return [
    ["fake", () => {
      const fake = createFakeProvider({ retry: { sleep: options.sleep } });
      return {
        label: "fake",
        kind: "asana",
        provider: fake,
        destinationId: "dest-engineering",
        workspaceId: "workspace-brand",
        tasks: () => fake.tasks.map((task) => ({ id: task.id, completed: task.completed, canceled: task.canceled, comments: task.comments })),
        failCreate: (failure) => fake.failNext({ operation: "createTask", ...failure }),
      };
    }],
    ["asana", () => {
      const server = fakeAsanaServer();
      return {
        label: "asana",
        kind: "asana",
        provider: createAsanaProvider({
          token: "test-asana-token",
          fetchImpl: server.fetch,
          retry: { sleep: options.sleep, attempts: 4, baseDelayMs: 250 },
        }),
        destinationId: "proj-1",
        workspaceId: "ws-1",
        tasks: () => server.tasks.map((task) => ({ id: task.id, completed: task.completed, canceled: false, comments: task.comments })),
        failCreate: (failure) => server.fail({
          method: "POST",
          match: "/api/1.0/tasks",
          status: failure.status,
          times: failure.times,
          afterWrite: failure.afterWrite,
          retryAfterSeconds: failure.retryAfterSeconds,
        }),
      };
    }],
    ["linear", () => {
      const server = fakeLinearServer();
      return {
        label: "linear",
        kind: "linear",
        provider: createLinearProvider({
          token: "test-linear-token",
          fetchImpl: server.fetch,
          retry: { sleep: options.sleep, attempts: 4, baseDelayMs: 250 },
        }),
        destinationId: "lp-1",
        workspaceId: "team-1",
        tasks: () => server.issues.map((issue) => ({
          id: issue.id,
          completed: !!issue.completedAt,
          canceled: !!issue.canceledAt,
          comments: issue.comments,
        })),
        failCreate: (failure) => server.fail({
          match: "issueCreate",
          status: failure.status,
          times: failure.times,
          afterWrite: failure.afterWrite,
          retryAfterSeconds: failure.retryAfterSeconds,
        }),
      };
    }],
  ];
}

const body = "# PW-1 — the page is slow\n\n## Remediation\n1. Compress the hero image.";
const baseInput = (destinationId: string, workspaceId: string) => ({
  destinationId,
  workspaceId,
  title: "PW-1 — the page is slow",
  body,
  marker: MARKER,
  assigneeEmail: "rae@webflow.com",
});

describe.each(harnesses())("task provider contract: %s", (_name, setup) => {
  it("lists destinations and users", async () => {
    const harness = setup();
    const destinations = await harness.provider.listDestinations();
    expect(destinations.length).toBeGreaterThan(0);
    expect(destinations[0].workspaceId).toBeTruthy();
    const users = await harness.provider.listUsers();
    expect(users.some((user) => user.email === "rae@webflow.com")).toBe(true);
  });

  it("creates, links, reads, comments, closes and reopens one task", async () => {
    const harness = setup();
    const created = await harness.provider.createTask(baseInput(harness.destinationId, harness.workspaceId));
    expect(created.completed).toBe(false);
    expect(created.canceled).toBe(false);

    // Link: the marker is findable and names the same task.
    const found = await harness.provider.findTaskByMarker(harness.destinationId, MARKER);
    expect(found?.id).toBe(created.id);

    const read = await harness.provider.getTask(created.id);
    expect(read.id).toBe(created.id);
    expect(read.assignee).toBeTruthy();

    await harness.provider.comment(created.id, "Started");
    const afterComment = harness.tasks().find((task) => task.id === created.id);
    expect(afterComment?.comments).toContain("Started");

    const closed = await harness.provider.close(created.id, "Not now");
    expect(closed.completed).toBe(true);
    const afterClose = harness.tasks().find((task) => task.id === created.id);
    expect(afterClose?.completed).toBe(true);
    expect(afterClose?.comments.join("\n")).toContain("Closed from Page Watch — Not now");

    const reopened = await harness.provider.reopen(created.id);
    expect(reopened.completed).toBe(false);
    expect(harness.tasks().find((task) => task.id === created.id)?.completed).toBe(false);
  });

  it("is idempotent: the same marker creates one task, not two", async () => {
    const harness = setup();
    const first = await harness.provider.createTask(baseInput(harness.destinationId, harness.workspaceId));
    const second = await harness.provider.createTask(baseInput(harness.destinationId, harness.workspaceId));
    expect(second.id).toBe(first.id);
    expect(harness.tasks()).toHaveLength(1);
  });

  it("retries a 429 with exponential backoff and creates one task", async () => {
    const delays: number[] = [];
    const { label } = setup();
    const target = setupWithRecorder(delays, label);
    target.failCreate({ status: 429, times: 2 });
    const task = await target.provider.createTask(baseInput(target.destinationId, target.workspaceId));
    expect(task.id).toBeTruthy();
    expect(target.tasks()).toHaveLength(1);
    expect(delays).toEqual([250, 500]);
  });

  it("honours Retry-After over the computed delay", async () => {
    const delays: number[] = [];
    const harness = setupWithRecorder(delays, "asana");
    harness.failCreate({ status: 429, times: 1, retryAfterSeconds: 1 });
    await harness.provider.createTask(baseInput(harness.destinationId, harness.workspaceId));
    expect(delays).toEqual([1000]);
  });

  it("does not duplicate when a 5xx arrives after the write was committed", async () => {
    const harness = setup();
    harness.failCreate({ status: 503, times: 1, afterWrite: true });
    const task = await harness.provider.createTask(baseInput(harness.destinationId, harness.workspaceId));
    expect(task.id).toBeTruthy();
    expect(harness.tasks()).toHaveLength(1);
  });

  it("stops retrying a non-retryable error", async () => {
    const harness = setup();
    harness.failCreate({ status: 401, times: 2 });
    await expect(harness.provider.createTask(baseInput(harness.destinationId, harness.workspaceId))).rejects.toMatchObject({ status: 401 });
  });
});

/**
 * A harness built with a delay recorder. Kept separate from the parameterised
 * list because only the retry assertions need to observe the backoff.
 */
function setupWithRecorder(delays: number[], label: "fake" | "asana" | "linear"): Harness {
  const sleep = async (ms: number) => { delays.push(ms); };
  if (label === "fake") {
    const fake = createFakeProvider({ retry: { sleep, attempts: 4, baseDelayMs: 250 } });
    return {
      label,
      kind: "asana",
      provider: fake,
      destinationId: "dest-engineering",
      workspaceId: "workspace-brand",
      tasks: () => fake.tasks.map((task) => ({ id: task.id, completed: task.completed, canceled: task.canceled, comments: task.comments })),
      failCreate: (failure) => fake.failNext({ operation: "createTask", ...failure }),
    };
  }
  if (label === "linear") {
    const server = fakeLinearServer();
    return {
      label,
      kind: "linear",
      provider: createLinearProvider({ token: "t", fetchImpl: server.fetch, retry: { sleep, attempts: 4, baseDelayMs: 250 } }),
      destinationId: "lp-1",
      workspaceId: "team-1",
      tasks: () => server.issues.map((issue) => ({ id: issue.id, completed: !!issue.completedAt, canceled: !!issue.canceledAt, comments: issue.comments })),
      failCreate: (failure) => server.fail({ match: "issueCreate", ...failure }),
    };
  }
  const server = fakeAsanaServer();
  return {
    label,
    kind: "asana",
    provider: createAsanaProvider({ token: "t", fetchImpl: server.fetch, retry: { sleep, attempts: 4, baseDelayMs: 250 } }),
    destinationId: "proj-1",
    workspaceId: "ws-1",
    tasks: () => server.tasks.map((task) => ({ id: task.id, completed: task.completed, canceled: false, comments: task.comments })),
    failCreate: (failure) => server.fail({ method: "POST", match: "/api/1.0/tasks", ...failure }),
  };
}
