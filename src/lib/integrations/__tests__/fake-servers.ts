/**
 * Fake provider servers for the contract tests.
 *
 * A fetch implementation, not a socket: it takes the same `RequestInit` and
 * returns the same `Response`, so the adapters exercise their real URL
 * building, headers, JSON shapes, pagination and error handling. No live Asana
 * or Linear app or secret is involved, and the proof says so.
 */

export interface FailureRule {
  method?: string;
  /** Substring of the URL (Asana) or of the GraphQL query (Linear). */
  match: string;
  status: number;
  times?: number;
  /** Perform the write, then fail — the retry-after-commit case. */
  afterWrite?: boolean;
  retryAfterSeconds?: number;
}

export interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface FakeTask {
  id: string;
  name: string;
  notes: string;
  completed: boolean;
  url: string;
  assignee?: { id: string; name: string; email?: string };
  comments: string[];
}

export interface FakeAsanaServer {
  fetch: typeof fetch;
  tasks: FakeTask[];
  requests: RecordedRequest[];
  fail(rule: FailureRule): void;
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function takeFailure(rules: FailureRule[], rule: FailureRule): "before" | "after" | null {
  const index = rules.findIndex((candidate) => candidate === rule && (candidate.times ?? 1) > 0);
  if (index < 0) return null;
  rule.times = (rule.times ?? 1) - 1;
  if (rule.times <= 0) rules.splice(index, 1);
  return rule.afterWrite ? "after" : "before";
}

function failing(rule: FailureRule): Response {
  const headers: Record<string, string> = {};
  if (rule.retryAfterSeconds) headers["Retry-After"] = String(rule.retryAfterSeconds);
  return json({ errors: [{ message: `injected ${rule.status}` }] }, rule.status, headers);
}

export function fakeAsanaServer(): FakeAsanaServer {
  const tasks: FakeTask[] = [];
  const requests: RecordedRequest[] = [];
  const rules: FailureRule[] = [];
  let counter = 0;
  const workspaces = [{ gid: "ws-1", name: "Brand Studio" }];
  const projects = [{ gid: "proj-1", name: "Engineering" }, { gid: "proj-2", name: "Website" }];
  const users = [
    { gid: "u-rae", name: "Rae", email: "rae@webflow.com" },
    { gid: "u-ben", name: "Ben", email: "ben@webflow.com" },
  ];

  const asanaTask = (task: FakeTask) => ({
    gid: task.id,
    name: task.name,
    notes: task.notes,
    completed: task.completed,
    permalink_url: task.url,
    assignee: task.assignee ? { gid: task.assignee.id, name: task.assignee.name } : null,
  });

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ method, url: url.toString(), body });

    for (const rule of [...rules]) {
      if (rule.method && rule.method !== method) continue;
      if (!`${method} ${url.pathname}${url.search}`.includes(rule.match)) continue;
      const effect = takeFailure(rules, rule);
      if (effect === "before") return failing(rule);
      // `after` falls through to the real handler, then fails at the end.
      const response = handle();
      return effect === "after" ? failing(rule) : response;
    }
    return handle();

    function handle(): Response {
      if (method === "GET" && url.pathname.endsWith("/workspaces")) return json({ data: workspaces });
      if (method === "GET" && url.pathname.endsWith("/projects")) {
        return json({ data: projects, next_page: null });
      }
      if (method === "GET" && url.pathname.endsWith("/users")) return json({ data: users });
      if (method === "GET" && url.pathname.endsWith("/tasks")) {
        const project = url.searchParams.get("project");
        void project;
        return json({ data: tasks.map(asanaTask), next_page: null });
      }
      if (method === "POST" && url.pathname.endsWith("/tasks")) {
        const payload = (body as { data?: { name?: string; notes?: string; assignee?: string } })?.data ?? {};
        counter += 1;
        const assignee = users.find((user) => user.gid === payload.assignee);
        const task: FakeTask = {
          id: `asana-${counter}`,
          name: payload.name ?? "",
          notes: payload.notes ?? "",
          completed: false,
          url: `https://app.asana.com/0/1/asana-${counter}`,
          ...(assignee ? { assignee: { id: assignee.gid, name: assignee.name, email: assignee.email } } : {}),
          comments: [],
        };
        tasks.push(task);
        return json({ data: asanaTask(task) });
      }
      const taskMatch = /\/tasks\/([^/]+)(\/addComment)?$/.exec(url.pathname);
      if (taskMatch) {
        const task = tasks.find((candidate) => candidate.id === taskMatch[1]);
        if (!task) return json({ errors: [{ message: "not found" }] }, 404);
        if (method === "GET" && !taskMatch[2]) return json({ data: asanaTask(task) });
        if (method === "POST" && taskMatch[2]) {
          const text = (body as { data?: { text?: string } })?.data?.text ?? "";
          task.comments.push(text);
          return json({ data: { gid: `${task.id}-comment` } });
        }
        if (method === "PUT") {
          const payload = (body as { data?: { name?: string; notes?: string; completed?: boolean; assignee?: string } })?.data ?? {};
          if (payload.name !== undefined) task.name = payload.name;
          if (payload.notes !== undefined) task.notes = payload.notes;
          if (payload.completed !== undefined) task.completed = payload.completed;
          if (payload.assignee !== undefined) {
            const assignee = users.find((user) => user.gid === payload.assignee);
            if (assignee) task.assignee = { id: assignee.gid, name: assignee.name, email: assignee.email };
            else delete task.assignee;
          }
          return json({ data: asanaTask(task) });
        }
      }
      return json({ errors: [{ message: `unhandled ${method} ${url.pathname}` }] }, 404);
    }
  }) as typeof fetch;

  return { fetch: fetchImpl, tasks, requests, fail: (rule) => rules.push(rule) };
}

/* ── Linear ─────────────────────────────────────────────────────────────── */

export interface FakeLinearIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
  description: string;
  stateId: string;
  completedAt: string | null;
  canceledAt: string | null;
  assigneeId?: string;
  teamId: string;
  comments: string[];
}

export interface FakeLinearServer {
  fetch: typeof fetch;
  issues: FakeLinearIssue[];
  requests: RecordedRequest[];
  fail(rule: FailureRule): void;
}

const LINEAR_STATES = [
  { id: "state-open", name: "Todo", type: "unstarted" },
  { id: "state-started", name: "In Progress", type: "started" },
  { id: "state-done", name: "Done", type: "completed" },
  { id: "state-canceled", name: "Canceled", type: "canceled" },
];

export function fakeLinearServer(): FakeLinearServer {
  const issues: FakeLinearIssue[] = [];
  const requests: RecordedRequest[] = [];
  const rules: FailureRule[] = [];
  let counter = 0;
  const users = [
    { id: "u-rae", name: "Rae", email: "rae@webflow.com" },
    { id: "u-ben", name: "Ben", email: "ben@webflow.com" },
  ];

  const issueNode = (issue: FakeLinearIssue) => {
    const state = LINEAR_STATES.find((candidate) => candidate.id === issue.stateId) ?? LINEAR_STATES[0];
    const assignee = users.find((user) => user.id === issue.assigneeId);
    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
      title: issue.title,
      description: issue.description,
      completedAt: issue.completedAt,
      canceledAt: issue.canceledAt,
      state,
      assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
      team: { id: issue.teamId },
    };
  };

  function applyUpdate(id: string, input: Record<string, unknown>): FakeLinearIssue | null {
    const issue = issues.find((candidate) => candidate.id === id);
    if (!issue) return null;
    if (typeof input.title === "string") issue.title = input.title;
    if (typeof input.description === "string") issue.description = input.description;
    if (typeof input.stateId === "string") {
      issue.stateId = input.stateId;
      const state = LINEAR_STATES.find((candidate) => candidate.id === input.stateId);
      if (state?.type === "completed") issue.completedAt = "2026-11-10T00:00:00.000Z";
      else {
        issue.completedAt = null;
        issue.canceledAt = state?.type === "canceled" ? "2026-11-10T00:00:00.000Z" : null;
      }
    }
    if ("assigneeId" in input) issue.assigneeId = typeof input.assigneeId === "string" ? input.assigneeId : undefined;
    return issue;
  }

  const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof init.body === "string" ? init.body : "{}";
    const { query, variables } = JSON.parse(raw) as { query: string; variables: Record<string, unknown> };
    requests.push({ method: "POST", url: "https://api.linear.app/graphql", body: { query, variables } });

    for (const rule of [...rules]) {
      if (!query.includes(rule.match)) continue;
      const effect = takeFailure(rules, rule);
      if (effect === "before") return failing({ ...rule, status: rule.status });
      const response = handle();
      return effect === "after" ? failing(rule) : response;
    }
    return handle();

    function handle(): Response {
      if (query.includes("teams {")) {
        return json({
          data: {
            teams: {
              nodes: [{ id: "team-1", name: "Engineering", key: "ENG", projects: { nodes: [{ id: "lp-1", name: "Website" }] } }],
            },
          },
        });
      }
      if (query.includes("users {")) return json({ data: { users: { nodes: users } } });
      if (query.includes("team(id:")) return json({ data: { team: { states: { nodes: LINEAR_STATES } } } });
      if (query.includes("issueCreate")) {
        counter += 1;
        const input = (variables.input ?? {}) as Record<string, unknown>;
        const issue: FakeLinearIssue = {
          id: `linear-${counter}`,
          identifier: `ENG-${counter}`,
          url: `https://linear.app/brand/issue/ENG-${counter}`,
          title: String(input.title ?? ""),
          description: String(input.description ?? ""),
          stateId: "state-open",
          completedAt: null,
          canceledAt: null,
          teamId: String(input.teamId ?? "team-1"),
          comments: [],
          ...(typeof input.assigneeId === "string" ? { assigneeId: input.assigneeId } : {}),
        };
        issues.push(issue);
        return json({ data: { issueCreate: { success: true, issue: issueNode(issue) } } });
      }
      if (query.includes("issueUpdate")) {
        const updated = applyUpdate(String(variables.id), (variables.input ?? {}) as Record<string, unknown>);
        return updated
          ? json({ data: { issueUpdate: { success: true, issue: issueNode(updated) } } })
          : json({ data: { issueUpdate: { success: false, issue: null } } });
      }
      if (query.includes("commentCreate")) {
        const comment = (variables.input ?? {}) as Record<string, unknown>;
        const issue = issues.find((candidate) => candidate.id === comment.issueId);
        issue?.comments.push(String(comment.body ?? ""));
        return json({ data: { commentCreate: { success: true } } });
      }
      if (query.includes("issues(")) {
        const projectId = variables.projectId;
        void projectId;
        return json({
          data: {
            issues: {
              nodes: issues.map(issueNode),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      if (query.includes("issue(id:")) {
        const issue = issues.find((candidate) => candidate.id === String(variables.id));
        return json({ data: { issue: issue ? issueNode(issue) : null } });
      }
      return json({ errors: [{ message: `unhandled query: ${query.slice(0, 60)}` }] }, 400);
    }
  }) as typeof fetch;

  return { fetch: fetchImpl, issues, requests, fail: (rule) => rules.push(rule) };
}
