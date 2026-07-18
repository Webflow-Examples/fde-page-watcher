# Contributing

This repo uses a **branch + pull request** workflow. Don't commit directly to `main`.

## Workflow

1. Branch off an up-to-date `main`:
   ```
   git checkout main
   git pull
   git checkout -b <type>/<short-description>
   ```
   Use a `type/` prefix: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.

2. Make the change and verify locally:
   ```
   npm run lint
   npx tsc --noEmit
   npm run build
   ```
   Then drive the affected route(s) against the dev server (`npm run dev`, http://localhost:3100).

3. Push and open a PR:
   ```
   git push -u origin <branch>
   gh pr create --fill
   ```
   Fill in the PR template.

4. Merge after review and green checks. Squash-merge keeps `main` history tidy.

## Local setup

- `npm install` (this environment wraps npm with Socket Firewall; if an install is
  blocked on a benign transitive dep, prefix with `SFW_BYPASS=1`).
- Copy `.env.local.example` to `.env.local` for optional keys (`PAGESPEED_API_KEY`,
  `SLACK_WEBHOOK_URL`, `CRON_SECRET`, `PSI_RUNS`). None are required to run locally.
