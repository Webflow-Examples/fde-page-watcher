# Task-tool integrations

Page Watch can create a task in **Asana** or **Linear** for a case, link it
back, and read what happened to it. This document is the whole setup, the
boundary the feature keeps, and what is deliberately not built.

The decision is `DECISIONS.md` 7. In one sentence: **Page Watch owns the
problem, its evidence, its lifecycle and its plan; the task tool owns execution
— who is doing it, comments, subtasks and delivery state.** A completion is a
signal that the change shipped, not a resolution. The 2/7/30-day checkpoints
still decide Resolved, and nothing in the task tool can resolve or dismiss a
case.

## What is created

One task per **remediation**, not per case. Siblings that share a fix share one
task, because asking somebody to finish the same job twice is not a feature.
The body of the task is exactly the markdown **Copy as ticket** produces, plus a
hidden marker:

```
<!-- page-watch:<projectId>:<remediationKey> -->
```

The marker is how a retried create finds the task the first attempt already
made. Nothing else leaves the app: the evidence ledger, raw PSI/agent reports,
visitor data and the case's page contents are never sent.

The assignee is the case owner's account email mapped to a provider user. If no
user matches, the task is created unassigned and the response carries a visible
note saying so.

## Environment

| Variable | Required for | Notes |
|---|---|---|
| `INTEGRATION_TOKEN_KEY` | any connection, webhook secret, OAuth state | 32 raw bytes base64 (`openssl rand -base64 32`), 64 hex chars, or a 32+ character passphrase hashed with SHA-256. Stored tokens are AES-256-GCM encrypted with it and bound to the project and provider. |
| `ASANA_CLIENT_ID`, `ASANA_CLIENT_SECRET` | connecting Asana | OAuth app credentials. |
| `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` | connecting Linear | OAuth app credentials. |
| `ASANA_API_BASE`, `LINEAR_GRAPHQL_ENDPOINT` | optional | Point an adapter at a local stand-in (the UI proof uses this). Leave unset in a deployment. |

A missing `INTEGRATION_TOKEN_KEY` fails at the connection attempt with that
name in the message. It never falls back to a default key: a default key is a
key an attacker already has.

Provider tokens are never returned to the browser. `GET /api/integrations/state`
returns only the public connection shape, and the settings payload exposes the
API token's six-character prefix and the webhook URL, never a secret.

## Scopes

**Asana** requests create and update: `tasks:read`, `tasks:write`,
`projects:read`, `users:read`. The adapter uses:

- `GET /workspaces`
- `GET /projects?workspace=…`
- `GET /users?workspace=…`
- `GET /tasks?project=…` (marker lookup)
- `GET /tasks/{id}`
- `POST /tasks`
- `PUT /tasks/{id}`
- `POST /tasks/{id}/addComment`

**Linear** requests `read`, `issues:create`, `comments:create` and uses the
GraphQL API at `https://api.linear.app/graphql`: `teams`, `users`, `issues`,
`issueCreate`, `issueUpdate`, `commentCreate`, and the team's workflow states so
"close" means the team's own completed state.

OAuth endpoints:

- Asana: `https://app.asana.com/-/oauth_authorize` and
  `https://app.asana.com/-/oauth_token`.
- Linear: `https://linear.app/oauth/authorize` and
  `https://api.linear.app/oauth/token`.

## OAuth app registration checklist

1. Create an OAuth application in Asana (developer console → OAuth apps) or
   Linear (Settings → API → OAuth applications).
2. Set the redirect/callback URL to
   `<deployment-origin><base-path>/api/integrations/asana/oauth/callback` or
   `.../linear/oauth/callback`. It must match exactly, including the base path.
3. Request the scopes above.
4. Put the client id and secret in the deployment's secrets (Webflow Cloud /
   Wrangler), not in the repository.
5. Set `INTEGRATION_TOKEN_KEY` once, from a random source, and keep it stable:
   rotating it invalidates every stored provider token and webhook secret.
6. In Page Watch → Settings → Connected systems → **Task tools**, connect the
   provider. The OAuth start route is project-admin only; a viewer is refused
   with 403.
7. Choose the one default destination. A destination is a workspace plus
   project for Asana, or a team plus project for Linear.

The OAuth state is signed, names the project and provider, expires after ten
minutes, and is also kept in an HttpOnly `page-watch-integration-oauth` cookie.
The callback checks signature, expiry, provider, cookie and a fresh
project-admin check before exchanging the code.

## Automations

Four switches in Settings, not a rules engine. All default to off.

1. **Accept creates a task.**
2. **Dismiss closes the task with the dismissal reason.**
3. **Reopen comments and reopens the task.**
4. **Task completion adds a note and offers Mark fixed.** It never resolves.

They run from `/api/decisions` and `/api/case-transitions` *after* the
append-only log write. Each action is guarded by a row in `integration_events`
whose id is derived from the decision or transition stamp, so a repeated
dispatch does nothing. A provider outage never costs a person their decision:
the error is recorded and shown, and the decision stands.

## Outbound events and the automation token

`POST /api/integrations/webhook` sets an HTTPS endpoint and returns a signing
secret **once**. Every delivery is a JSON POST with:

- `x-pagewatch-event` — `page_watch.case_decided`,
  `page_watch.case_transitioned`, `page_watch.task_linked`,
  `page_watch.task_completed` or `page_watch.task_canceled`
- `x-pagewatch-delivery` — the event id
- `x-pagewatch-signature` — `sha256=<HMAC-SHA256 of the exact body with the
  secret>`

Delivery retries 429 and 5xx with exponential backoff (3 attempts). Event ids
are recorded before delivery, so a retry after a transport failure does not
send a second copy.

`POST /api/integrations/api-token` issues a project-scoped, **read-only** token
for an external automation. It is shown once; only its SHA-256 hash is stored.
It authorizes `GET /api/integrations/public/tasks?project=<id>` with
`Authorization: Bearer <token>` and can list task links. It cannot create,
close, comment on or unlink anything. `DELETE` revokes it.

## Status sync: outbound only

V1 polls. There is a Refresh button on a linked task and a scheduled read in
`/api/cron/nightly` (up to 10 links per project, and only when automation 4 is
on). A completed task adds one note (idempotent by event row) and offers **Mark
fixed** where the registry permits it — the case must be In progress and have a
plan. A canceled or won't-do task adds a note and points at Dismiss; it never
dismisses.

**No inbound webhook is added in this change.** The app sits behind Cloudflare
Access, and an inbound provider callback cannot pass Access. The follow-up is
either:

- a small **public worker** that accepts the provider's webhook, verifies the
  provider signature, and forwards a normalized event to the app through the
  cron/collector secret or a queue; or
- an **Access bypass** for a single `/api/integrations/inbound/*` path, with a
  provider-signature check in the route, and no session identity trusted from
  the request.

Neither is in this pull request, and the app is not opened up by it. The
existing `integration_events` table is the idempotency ledger the inbound
worker would need.

## The fake provider

`src/lib/integrations/fake.ts` is a deterministic task tool for tests and for
the UI proof. It has destinations, users, tasks, comments and scripted
failures:

```ts
const fake = createFakeProvider();
fake.failNext({ operation: "createTask", status: 429, times: 2 });
fake.failNext({ operation: "createTask", status: 503, effect: "after" });
```

`effect: "after"` performs the write and then fails, which is the case a retry
must survive without creating a second task. The HTTP fakes
(`__tests__/fake-servers.ts`) do the same for the Asana REST and Linear GraphQL
shapes, so the adapters' real URL building, headers, JSON parsing and error
handling are exercised.

The contract tests run create / marker-link / get / comment / close / reopen,
idempotency, 429 and 5xx retry with asserted backoff delays, Retry-After, and
no-duplicate-on-retry against the fake provider, the Asana fake server and the
Linear fake server.

## Deploy steps

1. Apply `migrations/0008_task_integrations.sql` to the project's D1 database
   (`wrangler d1 migrations apply`, or the Webflow Cloud equivalent).
2. Set `INTEGRATION_TOKEN_KEY` as a secret in the deployment.
3. Set the provider client id/secret pair(s) you intend to support.
4. Register the callback URL(s) in the provider's OAuth app.
5. Deploy. Open Settings → Connected systems → Task tools; connect a provider,
   choose a destination, then turn on only the automations the team asked for.
6. If an external automation receives events, set the outbound endpoint and
   copy the signing secret into that tool immediately — it is not shown again.
7. If the automation needs to read links, issue the API token and store it in
   the receiving tool; it is not shown again.

Rotating `INTEGRATION_TOKEN_KEY` disconnects every provider and invalidates
every webhook secret. Reconnect and reissue after rotating.

## Known limitation: live verification

**Live Asana and Linear verification has not been done.** It needs real OAuth
apps, real client ids and secrets, a deployment with `INTEGRATION_TOKEN_KEY`,
and an account in each provider. Everything in this pull request is proved
against the deterministic fake provider and the HTTP fake servers; the adapters
are written to the documented endpoints, but "it compiles and passes against a
fake" is not "it worked against Asana".

The things to check first when credentials are available: Asana's
`GET /users?opt_fields=email,name` returns email on the plan you use; Linear's
team default state names and `CommentCreateInput` accepted; and a retried
create after a real 5xx does not leave two tasks.
