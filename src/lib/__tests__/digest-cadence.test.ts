import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIGEST_CADENCE,
  DIGEST_CADENCES,
  DIGEST_CADENCE_LABEL,
  isDigestCadence,
  normalizeDigestCadence,
} from "../digestCadence";

/**
 * The cadence the footer states, and the setting it is not.
 *
 * S7 states the cadence; S8 makes it changeable. The tests that matter here are
 * therefore about what has NOT been built: no writable field, no route, no
 * control — because a persisted setting nothing writes to is what rule 15 calls
 * not a slot at all. And when S8 does land it, it must land as one switch: no
 * per-page, per-metric or per-severity variant, each of which would let a reader
 * silence the line that mattered and keep a subject claiming nothing needed them.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const code = (file: string) =>
  readFileSync(path.resolve(moduleDir, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the digest cadence", () => {
  it("has exactly two values, and daily is what the collector actually does", () => {
    expect(DIGEST_CADENCES).toEqual(["daily", "weekly"]);
    expect(Object.keys(DIGEST_CADENCE_LABEL).sort()).toEqual([...DIGEST_CADENCES].sort());
    // Not an arbitrary default: the collector runs nightly, so any other one
    // would have the footer describing a cadence nothing implements.
    expect(DEFAULT_DIGEST_CADENCE).toBe("daily");
  });

  it("reads as the default when nothing has been chosen", () => {
    expect(normalizeDigestCadence(undefined)).toBe(DEFAULT_DIGEST_CADENCE);
    expect(normalizeDigestCadence("fortnightly")).toBe(DEFAULT_DIGEST_CADENCE);
    expect(normalizeDigestCadence(null)).toBe(DEFAULT_DIGEST_CADENCE);
    expect(isDigestCadence("weekly")).toBe(true);
    expect(isDigestCadence("hourly")).toBe(false);
  });

  it("is stated, not stored — the setting is S8's", () => {
    /**
     * Rule 15: an evidence slot with no producer is not a slot, and an empty one
     * reads to the user as a reading that found nothing. So there is no
     * `AppState.digestCadence`, no mutation and no route until something writes
     * to them. `digestFor` passes the default, and S8 changes that one line.
     */
    expect(code("../types.ts")).not.toContain("digestCadence");
    expect(code("../mutations.ts")).not.toContain("DigestCadence");
    const routes = readdirSync(path.resolve(moduleDir, "../../app/api/settings"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(routes).not.toContain("digest-cadence");
  });

  it("is not tuned per page, per metric or per severity anywhere", () => {
    /**
     * Comments are stripped first. Both modules explain at length why there is
     * no per-severity switch, and a check that tripped over its own
     * justification would only teach the next editor to delete the paragraph.
     */
    for (const source of [code("../digestCadence.ts"), code("../digest.ts")]) {
      expect(source).not.toMatch(/severity/i);
      expect(source).not.toMatch(/\bmuted?\b|\bsilenced?\b|\bsubscri/i);
      // No scope on the cadence: it is one value for the site, so it is never
      // keyed by a page id or a metric.
      expect(source).not.toMatch(/cadence\s*\[|cadenceFor\s*\(/i);
    }
  });

  it("is the only thing that could change how much arrives", () => {
    // There is one message per site per run, and no branch anywhere that
    // suppresses one because of what it contains.
    const delivery = code("../dailyDigest.ts");
    expect(delivery).not.toMatch(/sections\.length\s*(===|>)|cameBack\s*(===|>)\s*0/);
  });
});
