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
 * Linear, as a task tool.
 *
 * GraphQL rather than REST. Same contract and same rule as Asana: create checks
 * the marker before every attempt, so a retry after a 5xx cannot leave two
 * issues in a project.
 *
 * Linear's states are per team, and "close" means moving to the team's completed
 * workflow state. The adapter looks that state up rather than hardcoding a name,
 * because a team may rename Done.
 */

export const LINEAR_OAUTH_AUTHORIZE = "https://linear.app/oauth/authorize";
export const LINEAR_OAUTH_TOKEN = "https://api.linear.app/oauth/token";
export const LINEAR_GRAPHQL = "https://api.linear.app/graphql";
/** Create and update issues; read projects, teams and users. */
export const LINEAR_SCOPES = ["read", "issues:create", "comments:create"] as const;

export interface LinearProviderOptions {
  token: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  retry?: { sleep?: (ms: number) => Promise<void>; attempts?: number; baseDelayMs?: number };
}

interface LinearIssue {
  id: string;
  identifier?: string;
  url?: string;
  title?: string;
  description?: string;
  completedAt?: string | null;
  canceledAt?: string | null;
  state?: { id?: string; name?: string; type?: string } | null;
  assignee?: { id?: string; name?: string; email?: string } | null;
  team?: { id: string } | null;
}

interface LinearUser {
  id: string;
  name?: string;
  email?: string;
}

interface LinearTeam {
  id: string;
  name?: string;
  key?: string;
  projects?: { nodes: Array<{ id: string; name: string }> };
  states?: { nodes: Array<{ id: string; name: string; type: string }> };
}

const PAGE_LIMIT = 10;

export function createLinearProvider(options: LinearProviderOptions): TaskProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? LINEAR_GRAPHQL;
  const retryOptions = options.retry ?? {};

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    let payload: { data?: T; errors?: Array<{ message?: string }> } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const retryAfter = Number(response.headers.get("retry-after") ?? "");
    if (!response.ok) {
      throw new ProviderError(`Linear GraphQL failed with ${response.status}`, {
        status: response.status,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        body: text.slice(0, 500),
      });
    }
    if (payload?.errors?.length) {
      throw new ProviderError(`Linear GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`, {
        status: 400,
        body: text.slice(0, 500),
      });
    }
    if (!payload?.data) throw new ProviderError("Linear GraphQL returned no data", { status: 502, body: text.slice(0, 500) });
    return payload.data;
  }

  function call<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, retryOptions);
  }

  function external(issue: LinearIssue): ExternalTask {
    return {
      id: issue.id,
      url: issue.url,
      state: issue.state?.name ?? (issue.completedAt ? "completed" : issue.canceledAt ? "canceled" : "unknown"),
      assignee: issue.assignee?.name ?? issue.assignee?.email,
      title: issue.title,
      completed: !!issue.completedAt || issue.state?.type === "completed",
      canceled: !!issue.canceledAt || issue.state?.type === "canceled",
    };
  }

  const ISSUE_FIELDS = "id identifier url title description completedAt canceledAt state { id name type } assignee { id name email } team { id }";

  interface IssuePage {
    issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };
  }

  async function findTask(destinationId: string, marker: string): Promise<ExternalTask | null> {
    let after: string | null = null;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const data: IssuePage = await graphql<IssuePage>(
        `query($projectId: ID!, $after: String) { issues(filter: { project: { id: { eq: $projectId } } }, first: 100, after: $after) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
        { projectId: destinationId, after },
      );
      const found = data.issues.nodes.find((issue: LinearIssue) => issue.description?.includes(marker));
      if (found) return external(found);
      if (!data.issues.pageInfo.hasNextPage) return null;
      after = data.issues.pageInfo.endCursor ?? null;
      if (!after) return null;
    }
    return null;
  }

  async function issue(id: string): Promise<LinearIssue> {
    const data = await graphql<{ issue: LinearIssue | null }>(
      `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
      { id },
    );
    if (!data.issue) throw new ProviderError(`no Linear issue ${id}`, { status: 404 });
    return data.issue;
  }

  async function teamStates(teamId: string): Promise<Array<{ id: string; name: string; type: string }>> {
    const data = await graphql<{ team: LinearTeam | null }>(
      "query($id: String!) { team(id: $id) { states { nodes { id name type } } } }",
      { id: teamId },
    );
    return data.team?.states?.nodes ?? [];
  }

  const provider: TaskProvider = {
    kind: "linear",
    async listDestinations() {
      return call(async () => {
        const data = await graphql<{ teams: { nodes: LinearTeam[] } }>(
          "query { teams { nodes { id name key projects { nodes { id name } } } } }",
        );
        const destinations: Destination[] = [];
        for (const team of data.teams.nodes ?? []) {
          for (const project of team.projects?.nodes ?? []) {
            destinations.push({
              id: project.id,
              name: project.name,
              workspaceId: team.id,
              workspaceName: team.name ?? team.key,
            });
          }
        }
        return destinations;
      });
    },
    async listUsers() {
      return call(async () => {
        const data = await graphql<{ users: { nodes: LinearUser[] } }>(
          "query { users { nodes { id name email } } }",
        );
        return (data.users.nodes ?? []).map((user): ProviderUser => ({
          id: user.id,
          name: user.name ?? user.email ?? user.id,
          email: user.email,
        }));
      });
    },
    async findTaskByMarker(destinationId, marker) {
      return call(() => findTask(destinationId, marker));
    },
    async createTask(input: CreateTaskInput) {
      return call(async () => {
        const existing = await findTask(input.destinationId, input.marker);
        if (existing) return existing;

        let assigneeId: string | undefined;
        if (input.assigneeEmail) {
          const users = await graphql<{ users: { nodes: LinearUser[] } }>(
            "query { users { nodes { id name email } } }",
          );
          assigneeId = users.users.nodes.find(
            (user) => user.email?.toLowerCase() === input.assigneeEmail!.toLowerCase(),
          )?.id;
        }
        const data = await graphql<{ issueCreate: { success: boolean; issue?: LinearIssue | null } }>(
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
          {
            input: {
              teamId: input.workspaceId,
              projectId: input.destinationId,
              title: input.title,
              description: `${input.body}\n\n${input.marker}`,
              ...(assigneeId ? { assigneeId } : {}),
            },
          },
        );
        if (!data.issueCreate.success || !data.issueCreate.issue) {
          throw new ProviderError("Linear issueCreate did not return an issue", { status: 502 });
        }
        return external(data.issueCreate.issue);
      });
    },
    async getTask(id) {
      return call(async () => external(await issue(id)));
    },
    async updateTask(id, patch: UpdateTaskInput) {
      return call(async () => {
        const input: Record<string, unknown> = {};
        if (patch.title !== undefined) input.title = patch.title;
        if (patch.body !== undefined) input.description = patch.body;
        if (patch.assigneeEmail !== undefined) {
          const users = await graphql<{ users: { nodes: LinearUser[] } }>(
            "query { users { nodes { id name email } } }",
          );
          input.assigneeId = users.users.nodes.find(
            (user) => user.email?.toLowerCase() === patch.assigneeEmail!.toLowerCase(),
          )?.id ?? null;
        }
        const data = await graphql<{ issueUpdate: { success: boolean; issue?: LinearIssue | null } }>(
          `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
          { id, input },
        );
        if (!data.issueUpdate.success || !data.issueUpdate.issue) {
          throw new ProviderError("Linear issueUpdate did not return an issue", { status: 502 });
        }
        return external(data.issueUpdate.issue);
      });
    },
    async comment(id, body) {
      return call(async () => {
        const data = await graphql<{ commentCreate: { success: boolean } }>(
          "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",
          { input: { issueId: id, body } },
        );
        if (!data.commentCreate.success) throw new ProviderError("Linear commentCreate failed", { status: 502 });
      });
    },
    async close(id, reason) {
      return call(async () => {
        const current = await issue(id);
        const states = await teamStates(current.team?.id ?? "");
        const done = states.find((state) => state.type === "completed");
        if (!done) throw new ProviderError("this Linear team has no completed workflow state", { status: 422 });
        const data = await graphql<{ issueUpdate: { success: boolean; issue?: LinearIssue | null } }>(
          `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
          { id, input: { stateId: done.id } },
        );
        await graphql(
          "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",
          { input: { issueId: id, body: `Closed from Page Watch — ${reason}` } },
        );
        if (!data.issueUpdate.success || !data.issueUpdate.issue) {
          throw new ProviderError("Linear issueUpdate did not return an issue", { status: 502 });
        }
        return external(data.issueUpdate.issue);
      });
    },
    async reopen(id) {
      return call(async () => {
        const current = await issue(id);
        const states = await teamStates(current.team?.id ?? "");
        const open = states.find((state) => state.type === "unstarted")
          ?? states.find((state) => state.type === "backlog")
          ?? states.find((state) => state.type === "started");
        if (!open) throw new ProviderError("this Linear team has no open workflow state", { status: 422 });
        const data = await graphql<{ issueUpdate: { success: boolean; issue?: LinearIssue | null } }>(
          `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
          { id, input: { stateId: open.id } },
        );
        if (!data.issueUpdate.success || !data.issueUpdate.issue) {
          throw new ProviderError("Linear issueUpdate did not return an issue", { status: 502 });
        }
        return external(data.issueUpdate.issue);
      });
    },
  };

  return provider;
}
