import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SETTINGS_EXCLUDED_SITE_SCOPE } from "../settings-copy";

/**
 * One narrowing per record, and one place a check may be set aside.
 *
 * Both halves of F6's structural claim, asserted against the tree rather than
 * promised in a comment.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The records that can carry an exclusion reason, and the module that owns each.
 *
 * This is a list of RECORDS, not of narrowing sites, and the difference is the
 * whole point. A test that enumerated sites would go green the moment a seventh
 * was added and the list updated — which is exactly how three separate gates
 * over `NativeElementControl.excluded` survived review. Adding a row here means
 * adding a record, which is a decision somebody has to make on purpose and
 * defend; it is not something a passing build can be bought with.
 *
 * The taxonomy is DECISIONS.md 6's own: exclusions are one list and several
 * records, and `settings-exclusions.ts` joins them on read.
 */
const RECORDS = [
  { record: "NativeElementControl.excluded", owner: "lib/nativeElements.ts" },
  { record: "AgentIgnoreSettings.reasons", owner: "lib/settings-exclusions.ts" },
  { record: "CaseDecisionRecord.reason", owner: "lib/case-decisions.ts" },
] as const;

/**
 * The narrowing itself: a membership test against the registry's reason list.
 *
 * Built fresh per use — a `/g` regex carries `lastIndex` between calls, and a
 * guard that skips every other file depending on call order is worse than none.
 */
const NARROWING = String.raw`EXCLUSION_REASONS[^;]*?\.includes\s*\(`;
const narrowingsIn = (code: string) => [...code.matchAll(new RegExp(NARROWING, "g"))];

function sourceFiles(from: string = SRC): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(from);
  return found;
}

describe("one narrowing per record", () => {
  it("gives every record exactly one", () => {
    for (const { record, owner } of RECORDS) {
      const code = readFileSync(path.join(SRC, owner), "utf8");
      expect(
        narrowingsIn(code),
        `${record} is narrowed more than once in ${owner}`,
      ).toHaveLength(1);
    }
  });

  it("leaves none anywhere else under src/", () => {
    // The half that makes this a property rather than a list: a fourth gate
    // over an existing record fails here wherever in the tree it is written,
    // and cannot be quieted by adding its path to something.
    const owners = new Set(RECORDS.map((entry) => path.join(SRC, entry.owner)));
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    const strays = files
      .filter((file) => !owners.has(file))
      .filter((file) => narrowingsIn(readFileSync(file, "utf8")).length > 0)
      .map((file) => path.relative(SRC, file));
    expect(strays).toEqual([]);
  });

  it("narrows for readers and writers alike, from the one gate", () => {
    // Serving both directions is what keeps it to one. The owner exports the
    // resolver; the route that accepts a reason and the mutation that stores
    // one call it instead of repeating the membership test.
    for (const { owner } of RECORDS) {
      const code = readFileSync(path.join(SRC, owner), "utf8");
      expect(code, `${owner} does not export its record's narrowing`)
        .toMatch(/export function narrow\w+ExclusionReason\(value: unknown\): ExclusionReason \| null/);
    }
  });
});

/* ── Excluding a check is site-wide (DECISIONS.md 6, reading B) ──────────── */

describe("a check is set aside for the whole site", () => {
  const signatureOf = (code: string, declaration: string): string => {
    const start = code.indexOf(declaration);
    expect(start, `${declaration} not found`).toBeGreaterThan(-1);
    return code.slice(start, code.indexOf("{", start));
  };

  it("takes no exclusion reason on the per-page check route", () => {
    // Half one, and the half that stops a future per-page override quietly
    // acquiring a reason and becoming an exclusion the Settings list cannot
    // show. A per-page ignore overrides a site-wide setting; the thing that
    // needs a reason is the setting.
    const route = readFileSync(
      path.join(SRC, "app/api/pages/[id]/agent-ignores/route.ts"),
      "utf8",
    );
    expect(route).not.toMatch(/reason/i);
  });

  it("takes no exclusion reason in the per-page check mutation, or under it", () => {
    expect(signatureOf(readFileSync(path.join(SRC, "lib/mutations.ts"), "utf8"),
      "export function setAgentIgnore(")).not.toMatch(/reason/i);
    expect(signatureOf(readFileSync(path.join(SRC, "lib/agentScoring.ts"), "utf8"),
      "export function updateAgentIgnoreOverride(")).not.toMatch(/reason/i);
  });

  it("offers no page-level surface that could word one", () => {
    // Half two. `setAgentIgnore` is the only per-page check path there is, and
    // no screen reaches it — so there is nowhere for a per-page override to be
    // labelled Exclude. If a screen ever calls it, this fails and the wording
    // question gets answered before it ships rather than after.
    const screens = sourceFiles(path.join(SRC, "app")).filter((file) => !file.includes(`${path.sep}api${path.sep}`));
    expect(screens.length).toBeGreaterThan(5);
    for (const file of screens) {
      expect(readFileSync(file, "utf8"), `${path.relative(SRC, file)} reaches the per-page check path`)
        .not.toMatch(/\bsetAgentIgnore\b/);
    }
  });

  it("says so on the row, where the rows either side of it are scoped", () => {
    const page = readFileSync(path.join(SRC, "app/(app)/settings/page.tsx"), "utf8");
    expect(page).toContain("SETTINGS_EXCLUDED_SITE_SCOPE");
    expect(page).toMatch(/row\.kind === "check"/);
    expect(SETTINGS_EXCLUDED_SITE_SCOPE).toBe("Every page");
  });

  it("keeps the excluded list in Settings and nowhere else", () => {
    // `settings-copy.ts` is where the string is declared; this is about where it
    // is RENDERED, which is the one screen that may offer the decision.
    const declaresIt = path.join(SRC, "lib", "settings-copy.ts");
    const painting = sourceFiles()
      .filter((file) => file !== declaresIt)
      .filter((file) => readFileSync(file, "utf8").includes("SETTINGS_EXCLUDED_LABEL"))
      .map((file) => path.relative(SRC, file));
    expect(painting).toEqual([path.join("app", "(app)", "settings", "page.tsx")]);
  });
});
