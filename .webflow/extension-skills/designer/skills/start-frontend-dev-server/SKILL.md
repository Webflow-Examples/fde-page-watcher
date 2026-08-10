---
name: start-frontend-dev-server
description: Detect a frontend framework in the workspace, install its dependencies if needed, start its dev server as a background task, and open the running site in the Studio Site Browser.
---

# Start Frontend Dev Server

Use this skill when the user asks you to run, preview, start, or open their
project — or when the workspace looks like a frontend project (Next.js, Astro,
Vite, Remix, Nuxt, SvelteKit, plain React with a `dev` script, etc.) and the
user is asking to make edits and see them live.

The goal is to end with:
- a background dev-server task running,
- its local URL loaded in the Site Browser,
- the user informed of both.

## 1. Detect the framework and package manager

Read `package.json` from the workspace root. Inspect `dependencies` and
`devDependencies`:

- `next` → **Next.js**
- `astro` → **Astro**
- `vite` (or `@vitejs/plugin-*`) → **Vite**
- `remix`, `@remix-run/*` → **Remix**
- `nuxt` → **Nuxt**
- `@sveltejs/kit` → **SvelteKit**
- Otherwise, if `scripts.dev` exists, treat that as the dev command as-is.
- If nothing above matches and there is no `scripts.dev`, stop and tell the
  user you cannot detect a dev command — do not guess.

Detect the package manager from the lockfile in the workspace root, in this
order:

1. `pnpm-lock.yaml` → `pnpm`
2. `bun.lock` or `bun.lockb` → `bun` (bun 1.2+ writes the text `bun.lock`;
   older versions and projects that opted in still use `bun.lockb`)
3. `yarn.lock` → `yarn`
4. `package-lock.json` → `npm`
5. No lockfile → default to `npm`, and tell the user you defaulted.

## 2. Install dependencies (only if needed)

Skip this step if `node_modules/` already exists at the workspace root.

Otherwise, run the install command in the foreground (not as a background task
— we need it to finish before starting the server):

- `pnpm install`
- `bun install`
- `yarn install`
- `npm install`

If install fails, surface the error and stop; do not attempt to start the
server.

## 3. Start the dev server as a background task

Run the framework's dev command via `bash` with `run_in_background: true`. Save
the returned `taskId` — you will report it to the user and may need it to stop
the server later.

Typical dev commands:

- Next.js, Astro, Remix, Nuxt, SvelteKit, most Vite templates:
  `<pkg-mgr> dev` (or `<pkg-mgr> run dev`)
- Bun: `bun run dev`
- Fall back to whatever `scripts.dev` says.

## 4. Discover the local URL from stdout

Poll `bash_output` on the taskId. Use a `filter` regex to catch the URL
banner most dev servers print:

```
https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:/[^\s]*)?
```

Most frameworks print a line like `Local: http://localhost:3000` within a few
seconds.

**Important about `bash_output`:** every `bash_output` call — filtered or
unfiltered — advances a read cursor and returns only what the task printed
since the previous call. That means once your filtered polls have run, the
startup lines they scanned have already been consumed and are no longer
readable through `bash_output`. To recover the full history you must read
the on-disk log file directly.

If you do not see a URL after ~30 seconds of polling:

1. Check the task's status via `bash_output`. If the process has already
   exited, the server failed to start — do not keep polling.
2. Read the full log file directly with the `read` tool at
   `.webflow/tasks/<taskId>.log` (relative to the workspace root). Do not
   rely on an unfiltered `bash_output` call — that only returns bytes
   printed since the last read, which is likely empty by this point.
3. Quote the *actual error* the log shows back to the user, verbatim, along
   with the taskId. Do not paraphrase it as "no output" or "no URL yet" —
   the user needs the underlying failure (port collision, missing dependency,
   config error, panic, etc.) to fix it, not the fact that polling timed
   out.
4. Only after quoting the error do you propose a remediation (rerun install,
   pick a different port, edit the config, etc.).

Do not fabricate a URL. Only navigate to a URL you actually read from the log.

## 5. Open the URL in the Site Browser

Call `browser_navigate` with the discovered URL. This loads the running dev
server into Studio's main view container. From there, subsequent edits you
make to workspace files trigger the framework's own HMR and the user sees
changes live.

## 6. Report back

Tell the user, in one short message:

- Which framework and package manager you detected.
- The URL you opened.
- The `taskId` of the background dev server, so they (or you) can stop it
  later with `bash_kill`.

## Stopping the server later

If the user asks you to stop, restart, or "kill the dev server," call
`bash_kill` with the saved `taskId`. Do not try to find it by grepping the
process list — the taskId is the durable handle.
