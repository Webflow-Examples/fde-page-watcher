## Base commit

<!-- The sha you branched from, and the result of the checks AT that sha.
     See AGENTS.md: report what you ran, not what an earlier session reported. -->

- Base sha: `<git rev-parse HEAD at branch point>`
- Checks at that sha: <green / red, and which step failed>

## What & why

<!-- What does this change do, and why? Link any spec/scope/issue. -->

## Changes

<!-- Bullet the notable changes. -->
-

## Verification

- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test -- --run` passes
- [ ] Drove the affected route(s) in the browser (dev server on :3100)
- [ ] Any repair of shared breakage is claimed in `REPAIRS.md` and kept in its
      own commit

## Notes

<!-- Anything reviewers should know: trade-offs, follow-ups, deferred work. -->
