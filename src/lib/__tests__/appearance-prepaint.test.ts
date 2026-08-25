import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPEARANCES,
  APPEARANCE_PREPAINT_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  resolveSurface,
  type Appearance,
} from "@/components/appearance";

/**
 * The pre-paint script and `resolveSurface` are one decision written twice.
 *
 * The duplication is deliberate and correct — the script runs before any bundle
 * has loaded, so it cannot import anything. What was missing is the mechanism
 * that keeps the copy honest: the storage key is interpolated, but the three
 * appearance values and the resolution rule are written out again inside the
 * string, and nothing compared them to the module they mirror.
 *
 * A disagreement here does not throw. It paints the wrong theme on first load
 * and then corrects itself once React hydrates, which reads as a flash rather
 * than as a bug, and would survive every other test in the suite.
 *
 * So this runs the real script — the same string the layout injects — against
 * every appearance and both device preferences, and asserts it lands where
 * `resolveSurface` says it should.
 */

/** The smallest window/document the script touches, per stored value and preference. */
function runPrepaint(stored: string | null, prefersDark: boolean): string | null {
  let surface: string | null = null;
  const scope = {
    localStorage: { getItem: (key: string) => (key === APPEARANCE_STORAGE_KEY ? stored : null) },
    matchMedia: (query: string) => ({ matches: query.includes("dark") && prefersDark }),
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          if (name === "data-surface") surface = value;
        },
      },
    },
  };
  // The script is an IIFE that reads bare `localStorage`, `window` and
  // `document`, so it is invoked with those as named parameters rather than
  // against a global.
  new Function("localStorage", "window", "document", APPEARANCE_PREPAINT_SCRIPT)(
    scope.localStorage,
    { matchMedia: scope.matchMedia },
    scope.document,
  );
  return surface;
}

describe("the pre-paint script and resolveSurface are one rule", () => {
  it("agrees on every appearance, under both device preferences", () => {
    for (const appearance of APPEARANCES) {
      for (const prefersDark of [true, false]) {
        expect(
          runPrepaint(appearance, prefersDark),
          `${appearance} with prefers-dark=${prefersDark}`,
        ).toBe(resolveSurface(appearance, prefersDark));
      }
    }
  });

  it("treats anything unstored or unrecognised as Auto, the same way the module does", () => {
    for (const stored of [null, "", "Dark", "system", "true"]) {
      for (const prefersDark of [true, false]) {
        expect(runPrepaint(stored, prefersDark), `stored=${JSON.stringify(stored)}`)
          .toBe(resolveSurface("auto", prefersDark));
      }
    }
  });

  it("recognises exactly the appearances the module exports", () => {
    // A value added to APPEARANCES but not to the script's guard would fall
    // through to Auto and quietly ignore the user's choice.
    for (const appearance of APPEARANCES) {
      expect(APPEARANCE_PREPAINT_SCRIPT, `${appearance} is not recognised by the script`)
        .toContain(`"${appearance}"`);
    }
  });

  it("writes only surfaces the stylesheet defines a block for", () => {
    // `data-surface` selects a theme block. A value with no block renders the
    // light cascade with no error at all.
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const written = new Set<string>();
    for (const appearance of [...APPEARANCES, "nonsense"] as Appearance[]) {
      for (const prefersDark of [true, false]) {
        const surface = runPrepaint(appearance, prefersDark);
        if (surface) written.add(surface);
      }
    }
    expect(written).toEqual(new Set(["light", "dark"]));
    expect(css).toContain('[data-surface="dark"]');
    // Light is the `:root` default rather than its own block.
    expect(css).toContain(":root {");
  });

  it("stays dependency-free and silent on failure", () => {
    // It runs inside dangerouslySetInnerHTML before the parser continues, so a
    // throw would block the document parse.
    expect(APPEARANCE_PREPAINT_SCRIPT).toContain("try{");
    expect(APPEARANCE_PREPAINT_SCRIPT).toContain("catch");
    expect(APPEARANCE_PREPAINT_SCRIPT).not.toMatch(/\bimport\b|\brequire\(/);
    // The key is interpolated rather than retyped, and must stay that way.
    expect(APPEARANCE_PREPAINT_SCRIPT).toContain(JSON.stringify(APPEARANCE_STORAGE_KEY));
  });
});
