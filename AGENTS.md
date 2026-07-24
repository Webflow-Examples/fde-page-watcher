# Repository instructions

## Node and npm reproducibility

- Webflow Cloud installs this project with npm `10.9.7`.
- Always run dependency and lockfile commands with npm `10.9.7`, even when the host machine has a newer npm. Use `npx --yes npm@10.9.7 <command>` when necessary.
- Never regenerate `package-lock.json` with npm 11. It can remove Vitest's nested `esbuild` records, causing Webflow Cloud's `npm ci` step to fail.
- Before committing any dependency or lockfile change, verify it with:
  - `npx --yes npm@10.9.7 ci --dry-run --ignore-scripts --no-audit --no-fund`
  - `npm run lint`
  - `npm test -- --run`
  - `npm run build`
