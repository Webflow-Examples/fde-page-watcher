# Contributing

This repo uses a **branch + pull request** workflow. Don't commit directly to `main`.

## Workflow

1. Branch off an up-to-date `main`, and check that it is actually green before
   you build on it (see AGENTS.md, "Before you build: check your base commit"):
   ```
   git checkout main
   git pull
   git rev-parse HEAD              # report this sha
   git checkout -b <type>/<short-description>
   ```
   Use a `type/` prefix: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.

2. Make the change and verify locally:
   ```
   npm run lint
   npm run typecheck
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

   A PR also carries a `base-branch-green` check, which reports whether `main`
   itself is passing. While `main` is red the merge is refused; the check
   re-posts itself when `main`'s CI finishes, so there is nothing to push. If
   you are fixing `main`, claim it in `REPAIRS.md` and label the PR `repair`,
   which waives that check.

## Local setup

- `npm install` (this environment wraps npm with Socket Firewall; if an install is
  blocked on a benign transitive dep, prefix with `SFW_BYPASS=1`).
- Copy `.env.local.example` to `.env.local` for optional keys (`PAGESPEED_API_KEY`,
  `SLACK_WEBHOOK_URL`, `CRON_SECRET`, `PSI_RUNS`). None are required to run locally.
