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
 * The cadence the footer states, and the shape of the setting behind it.
 *
 * S7 stated the cadence and deliberately did not store it: a persisted field
 * nothing writes to is what rule 15 calls not a slot at all. S8 built the
 * writer, so the assertion flips — what is checked now is that the setting
 * landed as ONE switch. No per-page, per-metric or per-severity variant, each
 * of which would let a reader silence the line that mattered while the subject
 * went on claiming nothing needed them.
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

  it("is stored, and by exactly one route", () => {
    /**
     * The slot has a producer now, which is what rule 15 was waiting for. One
     * route writes it, and it writes the recipients in the same call because
     * they are the same setting: how often, and to whom.
     *
     * The route is named `digest` rather than `digest-cadence`, and that is the
     * assertion worth keeping: a route per field is how one setting becomes
     * three.
     */
    expect(code("../types.ts")).toContain("digestCadence");
    expect(code("../mutations.ts")).toContain("DigestCadence");
    const routes = readdirSync(path.resolve(moduleDir, "../../app/api/settings"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(routes).toContain("digest");
    expect(routes.filter((name) => name.startsWith("digest-"))).toEqual([]);
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
