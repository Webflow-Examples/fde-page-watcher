# Zero-DNS email authentication

Page Watch uses the existing Cloudflare Access application only as an email
one-time-code identity broker. The production app remains at
`https://page-watcher.webflow.io`; no custom sender domain or DNS change is
required.

## Flow

1. `/login` links to `/api/auth/start` on the Webflow origin.
2. The app stores a random, host-only, HTTP-only login-state cookie and sends
   the browser to the Access-protected gateway's `/__auth/broker` route.
3. Cloudflare Access collects the email and sends its one-time code.
4. The gateway validates the Access JWT signature, issuer, audience, lifetime,
   token type, and email claim against Cloudflare's published signing keys.
5. The gateway signs a 60-second handoff containing the verified email, fixed
   Webflow audience, nonce, and browser state, then redirects to the fixed
   `/api/auth/callback` URL.
6. The callback verifies the handoff and state cookie, checks the D1 app-admin
   and project-membership registry, and creates a seven-day host-only session.

The gateway accepts no return URL, so it cannot become an open redirect. The
role registry is checked on every app request, so removing an invitation takes
effect even if the user's session cookie has not expired.

## Required configuration

Generate two independent values:

```sh
openssl rand -base64 48  # AUTH_HANDOFF_SECRET
openssl rand -base64 48  # AUTH_SESSION_SECRET
```

Set these Webflow Cloud environment variables:

```text
AUTH_BROKER_URL=https://fde-page-watcher-gateway.fde-webflow.workers.dev
AUTH_PUBLIC_ORIGIN=https://page-watcher.webflow.io
AUTH_HANDOFF_SECRET=<first generated value>
AUTH_SESSION_SECRET=<second generated value>
```

Set the first generated value on the gateway Worker:

```sh
npx wrangler secret put AUTH_HANDOFF_SECRET --config auth-gateway/wrangler.jsonc
```

The gateway config already contains the production callback, Access team
domain, and Access application audience. Deploy the gateway, then deploy the
Webflow app.

## Production verification

1. Open a private browser window at `https://page-watcher.webflow.io`.
2. Confirm the app redirects to `/login` on the same hostname.
3. Select **Continue with email**, complete Cloudflare's email-code screen, and
   confirm the final URL is `https://page-watcher.webflow.io/dashboard`.
4. Confirm an app admin sees every active project and Admin.
5. Confirm a project admin sees only invited projects and can manage members.
6. Confirm a project viewer sees only invited projects and cannot see or open
   Admin, Settings, or Watchlist, or mutate Inbox and Task items.
7. Try an uninvited email and confirm it returns to `/login` with an access
   error and receives no app session.
8. Sign out and confirm protected routes return to `/login`.

The Worker URL may appear only during the email-code step. It should never be
the URL users bookmark or the final post-login destination.
