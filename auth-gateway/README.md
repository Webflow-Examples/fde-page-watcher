# Page Watch zero-DNS authentication broker

Cloudflare Access protects this Worker and provides the email one-time-code
screen. Page Watch uses only `GET /__auth/broker` for login: the Worker
validates Access's signed JWT, issues a one-minute HMAC handoff bound to the
browser's login state, and redirects to the fixed Webflow Cloud callback. The
user then stays on `https://page-watcher.webflow.io` under a host-only session.

The legacy reverse-proxy behavior remains temporarily for rollback, but users
should receive the Webflow URL—not the Worker URL.

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
   Worker variables `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.
5. Set the same random `AUTH_HANDOFF_SECRET` on this Worker and Webflow Cloud.
6. Share `https://page-watcher.webflow.io` with users. An authenticated but
   uninvited email is rejected by the app's D1 role registry.

After Access is enabled, an unauthenticated request should redirect to the
Access login flow. Once authenticated, `GET /__gateway/health` returns a JSON
response with `ok: true`. A direct request to the Worker without Access still
fails closed with HTTP 401.
