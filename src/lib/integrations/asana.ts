import {
  ProviderError,
  withRetry,
  type CreateTaskInput,
  type Destination,
  type ExternalTask,
  type ProviderUser,
  type TaskProvider,
  type UpdateTaskInput,
} from "./provider";

/**
 * Asana, as a task tool.
 *
 * The adapter knows Asana's HTTP shapes and nothing about Page Watch's
 * lifecycle. It has one trick that is not obvious from the API: `createTask`
 * looks for the marker before every create, including on a retry, because a 503
 * can arrive after Asana committed the task. Without that check a retry is a
 * second task in somebody's project, which is the failure mode the unique link
 * row prevents in our own storage but cannot prevent at the provider.
 */

export const ASANA_OAUTH_AUTHORIZE = "https://app.asana.com/-/oauth_authorize";
export const ASANA_OAUTH_TOKEN = "https://app.asana.com/-/oauth_token";
export const ASANA_API_BASE = "https://app.asana.com/api/1.0";
/** Create and update tasks; read projects and users. */
export const ASANA_SCOPES = ["tasks:read", "tasks:write", "projects:read", "users:read"] as const;

export interface AsanaProviderOptions {
  token: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  retry?: { sleep?: (ms: number) => Promise<void>; attempts?: number; baseDelayMs?: number };
}

interface AsanaList<T> {
  data: T[];
  next_page?: { offset?: string | null } | null;
}

interface AsanaData<T> {
  data: T;
}

interface AsanaWorkspace {
  gid: string;
  name: string;
}

interface AsanaProject {
  gid: string;
  name: string;
}

interface AsanaUser {
  gid: string;
  name?: string;
  email?: string;
}

interface AsanaTask {
  gid: string;
  name?: string;
  notes?: string;
  completed?: boolean;
  permalink_url?: string;
  assignee?: { gid?: string; name?: string; email?: string } | null;
}

const PAGE_LIMIT = 10;

export function createAsanaProvider(options: AsanaProviderOptions): TaskProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBase = (options.apiBase ?? ASANA_API_BASE).replace(/\/+$/, "");
  const retryOptions = options.retry ?? {};

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${options.token}`);
    headers.set("Accept", "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetchImpl(`${apiBase}${path}`, { ...init, headers });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      throw new ProviderError(
        `Asana ${init.method ?? "GET"} ${path} failed with ${response.status}`,
        {
          status: response.status,
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
          body: text.slice(0, 500),
        },
      );
    }
    return payload as T;
  }

  /** Every provider call goes through one retry policy (429 and 5xx). */
  function call<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, retryOptions);
  }

  function external(task: AsanaTask): ExternalTask {
    return {
      id: task.gid,
      url: task.permalink_url,
      state: task.completed ? "completed" : "open",
      assignee: task.assignee?.name ?? task.assignee?.email,
      title: task.name,
      completed: task.completed === true,
      // Asana has no canceled state in the task object; deletion is the only
      // equivalent and is not something this integration does.
      canceled: false,
    };
  }

  async function usersIn(workspaceId: string | undefined): Promise<AsanaUser[]> {
    if (!workspaceId) return [];
    const result = await request<AsanaList<AsanaUser>>(
      `/users?workspace=${encodeURIComponent(workspaceId)}&opt_fields=name,email&limit=100`,
    );
    return result.data ?? [];
  }

  const provider: TaskProvider = {
    kind: "asana",
    async listDestinations() {
      return call(async () => {
        const workspaces = await request<AsanaList<AsanaWorkspace>>("/workspaces");
        const destinations: Destination[] = [];
        for (const workspace of workspaces.data ?? []) {
          const projects = await request<AsanaList<AsanaProject>>(
            `/projects?workspace=${encodeURIComponent(workspace.gid)}&opt_fields=name&limit=100`,
          );
          for (const project of projects.data ?? []) {
            destinations.push({
              id: project.gid,
              name: project.name,
              workspaceId: workspace.gid,
              workspaceName: workspace.name,
            });
          }
        }
        return destinations;
      });
    },
    async listUsers() {
      return call(async () => {
        const workspaces = await request<AsanaList<AsanaWorkspace>>("/workspaces");
        const users: ProviderUser[] = [];
        for (const workspace of workspaces.data ?? []) {
          for (const user of await usersIn(workspace.gid)) {
            users.push({ id: user.gid, name: user.name ?? user.email ?? user.gid, email: user.email });
          }
        }
        return users;
      });
    },
    async findTaskByMarker(destinationId, marker) {
      return call(async () => {
        let offset: string | null | undefined;
        for (let page = 0; page < PAGE_LIMIT; page += 1) {
          const query = new URLSearchParams({
            project: destinationId,
            limit: "100",
            opt_fields: "name,notes,completed,permalink_url,assignee.name",
          });
          if (offset) query.set("offset", offset);
          const result = await request<AsanaList<AsanaTask>>(`/tasks?${query.toString()}`);
          const found = (result.data ?? []).find((task) => task.notes?.includes(marker));
          if (found) return external(found);
          offset = result.next_page?.offset;
          if (!offset) return null;
        }
        return null;
      });
    },
    async createTask(input: CreateTaskInput) {
      return call(async () => {
        // A retry must not duplicate: find a task this integration already made
        // before asking Asana for another one.
        const existing = await (async () => {
          const query = new URLSearchParams({
            project: input.destinationId,
            limit: "100",
            opt_fields: "name,notes,completed,permalink_url,assignee.name",
          });
          const result = await request<AsanaList<AsanaTask>>(`/tasks?${query.toString()}`);
          return (result.data ?? []).find((task) => task.notes?.includes(input.marker)) ?? null;
        })();
        if (existing) return external(existing);

        let assignee: string | undefined;
        if (input.assigneeEmail) {
          const users = await usersIn(input.workspaceId);
          assignee = users.find((user) => user.email?.toLowerCase() === input.assigneeEmail!.toLowerCase())?.gid;
        }
        const created = await request<AsanaData<AsanaTask>>("/tasks", {
          method: "POST",
          body: JSON.stringify({
            data: {
              name: input.title,
              notes: `${input.body}\n\n${input.marker}`,
              projects: [input.destinationId],
              ...(assignee ? { assignee } : {}),
            },
          }),
        });
        return external(created.data);
      });
    },
    async getTask(id) {
      return call(async () => {
        const result = await request<AsanaData<AsanaTask>>(
          `/tasks/${encodeURIComponent(id)}?opt_fields=name,notes,completed,permalink_url,assignee.name`,
        );
        return external(result.data);
      });
    },
    async updateTask(id, patch: UpdateTaskInput) {
      return call(async () => {
        const data: Record<string, unknown> = {};
        if (patch.title !== undefined) data.name = patch.title;
        if (patch.body !== undefined) data.notes = patch.body;
        const result = await request<AsanaData<AsanaTask>>(`/tasks/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ data }),
        });
        return external(result.data);
      });
    },
    async comment(id, body) {
      return call(async () => {
        await request(`/tasks/${encodeURIComponent(id)}/addComment`, {
          method: "POST",
          body: JSON.stringify({ data: { text: body } }),
        });
      });
    },
    async close(id, reason) {
      return call(async () => {
        const result = await request<AsanaData<AsanaTask>>(`/tasks/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ data: { completed: true } }),
        });
        await request(`/tasks/${encodeURIComponent(id)}/addComment`, {
          method: "POST",
          body: JSON.stringify({ data: { text: `Closed from Page Watch — ${reason}` } }),
        });
        return external(result.data);
      });
    },
    async reopen(id) {
      return call(async () => {
        const result = await request<AsanaData<AsanaTask>>(`/tasks/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ data: { completed: false } }),
        });
        return external(result.data);
      });
    },
  };

  return provider;
}
