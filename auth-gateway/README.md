# Page Watch authentication gateway

This Worker is the public authentication boundary for the Webflow Cloud app.
Cloudflare Access protects the Worker, adds a signed
`Cf-Access-Jwt-Assertion` header, and the Worker streams the request to
`https://page-watcher.webflow.io`. The Next.js app remains responsible for
validating the assertion and enforcing app-admin and project-level roles.

The Webflow origin remains fail-closed: requests that bypass the gateway do
not contain a valid Access assertion and cannot reach project data.

## Deploy

```sh
npm run gateway:typegen
npm run gateway:check
npm run gateway:dry-run
npm run gateway:deploy
```

Production Worker: `fde-page-watcher-gateway`

Default URL: <https://fde-page-watcher-gateway.fde-webflow.workers.dev>

## Cloudflare Access setup

1. In Cloudflare One, create a self-hosted Access application that protects
   the `fde-page-watcher-gateway` Worker. Protect the entire Worker.
2. Enable Email one-time PIN as an authentication method.
3. Create an Allow policy for all authenticated users. Access proves the email
   identity; Page Watch's D1 role registry remains authoritative for app and
   project access.
4. Copy the Access team domain and application audience tag into the Webflow
   Cloud variables `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.
5. Share the gateway URL, not the `webflow.io` origin URL, with users. An
   authenticated but uninvited email reaches the no-project-access screen and
   cannot read or mutate project data.

After Access is enabled, an unauthenticated request should redirect to the
Access login flow. Once authenticated, `GET /__gateway/health` returns a JSON
response with `ok: true`. A direct request to the Worker without Access still
fails closed with HTTP 401.
