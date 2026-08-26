# Repository instructions

## Before you build: check your base commit

`main` has broken four times in three days, and never once through a git
conflict. Each time, two changes that did not overlap textually were merged,
and the breakage existed only in the combination that neither branch had been
tested against. Git cannot raise a conflict for that. These rules are what
stands in its place.

- **Run the checks at your base commit and report the sha, before you build
  anything.**

  ```
  git rev-parse HEAD
  npm run lint && npm run typecheck && npm test -- --run && npm run build
  ```

  Put that sha in your first report and in the PR description. "The checks
  pass" is not a fact about this repo; it is a fact about one commit.

- **Do not inherit a failing-check list from an earlier report.** Another
  session's account of what was broken was true of that session's base commit,
  not yours. Re-run the checks and report what you actually saw.

- **If the base is red, say so and stop.** Report the sha and the failing step.
  Do not start the chunk on top of it.

- **Do not repair a red base inside a feature chunk.** That buries a shared
  defect in an unrelated diff, where it cannot be reviewed on its own, cannot be
  reverted on its own, and cannot be found by the session that hits it next.

## Repairing breakage you did not come here to write

If you must repair shared breakage, claim it **before you write the fix**, in
`REPAIRS.md` at the repo root. That file is the only place a repair is claimed,
and reading it is part of starting work:

```
git fetch origin
git show origin/main:REPAIRS.md    # claims that have landed
gh pr list --label repair          # claims still in flight
```

- **If the repair is already claimed, do not write your own.** The row names the
  branch; rebase onto it (`git rebase origin/<claimed-branch>`). Two independent
  fixes for one defect is how `main` ended up with duplicated code that git had
  no conflict to raise.
- **If it is unclaimed and you are taking it**, add the row to `REPAIRS.md`,
  open the PR straight away, and label it `repair`.
- **Put the repair in its own commit**, separate from any feature work, so it
  can be reviewed or reverted alone.

## Merging

- **A merge into `main` is refused while `main`'s own pipeline is failing.** The
  `base-branch-green` check on your PR republishes the result of `main`'s last
  CI run; branch protection requires it. This is not a warning and not a
  reviewer's judgement — the merge is blocked. It gates the merge, not your
  build: keep working, and merge when the base is green.
- **You do not have to push anything to ask again.** When `main`'s CI finishes,
  the check re-posts itself on every open PR.
- **A `repair`-labelled PR is exempt**, because a repair is how a red branch
  becomes green. That label is a claim in `REPAIRS.md`, not a way past the gate.
- **Never weaken a guard to make a pipeline pass** — no deleted assertion, no
  skipped test, no relaxed lint rule. If a guard is wrong, that is a repair:
  claim it and fix it in its own commit.

## Node and npm reproducibility

- Webflow Cloud installs this project with npm `10.9.7`.
- Always run dependency and lockfile commands with npm `10.9.7`, even when the host machine has a newer npm. Use `npx --yes npm@10.9.7 <command>` when necessary.
- Never regenerate `package-lock.json` with npm 11. It can remove Vitest's nested `esbuild` records, causing Webflow Cloud's `npm ci` step to fail.
- Before committing any dependency or lockfile change, verify it with:
  - `npx --yes npm@10.9.7 ci --dry-run --ignore-scripts --no-audit --no-fund`
  - `npm run lint`
  - `npm test -- --run`
  - `npm run build`
