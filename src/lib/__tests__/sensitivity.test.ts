import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { recordCheckpointReading } from "../checkpoint-evaluation";
import { buildDigest } from "../digest";
import { digestLimit } from "../digest-copy";
import { markFixed, type IssueCase } from "../issue-case";
import { pendingPage } from "../mutations";
import type { Caller } from "../caller";
import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  PERFORMANCE_THRESHOLD_LIMITS,
  normalizePerformanceThresholds,
  performanceThresholdsAreValid,
} from "../performanceThresholds";
import {
  DEFAULT_SENSITIVITY,
  SENSITIVITIES,
  SENSITIVITY_THRESHOLDS,
  exactSensitivity,
  nearestSensitivity,
  normalizeSensitivity,
} from "../sensitivity";
import { SENSITIVITY_LABEL, SETTINGS_SENSITIVITY_LIMIT_LABEL, settingsMigrated } from "../settings-copy";
import { normalizeState } from "../store/normalize";
import type { AppState, PerformanceThresholds, WatchPage } from "../types";

/**
 * One control, and the promise it makes.
 *
 * Option 10b is only honest if two things hold, and everything here is one of
 * them:
 *
 *   - The limits a position resolves to are the limits the digest uses. Not
 *     equivalent numbers — the same string, from the same function, so a
 *     reworded unit cannot reach one reader and not the other.
 *   - A configuration somebody made by hand is mapped rather than discarded,
 *     and its owner is told once.
 *
 * Registry rule 21: these assert against the other half of the decision rather
 * than against literals. `expect(limit).toBe("250 ms")` would prove that two
 * copies of one string agree, never that either is right.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const NUMERIC_KEYS = Object.keys(PERFORMANCE_THRESHOLD_LIMITS) as Array<keyof typeof PERFORMANCE_THRESHOLD_LIMITS>;

describe("the sensitivity positions", () => {
  it("has exactly the three the brief locked, and Normal is the default", () => {
    expect(SENSITIVITIES).toEqual(["low", "normal", "high"]);
    expect(Object.keys(SENSITIVITY_LABEL).sort()).toEqual([...SENSITIVITIES].sort());
    expect(DEFAULT_SENSITIVITY).toBe("normal");
    expect(normalizeSensitivity(undefined)).toBe(DEFAULT_SENSITIVITY);
    expect(normalizeSensitivity("paranoid")).toBe(DEFAULT_SENSITIVITY);
  });

  it("resolves every position to a complete, in-range, already-normal threshold set", () => {
    for (const position of SENSITIVITIES) {
      const thresholds = SENSITIVITY_THRESHOLDS[position];
      expect(performanceThresholdsAreValid(thresholds), position).toBe(true);
      // Normalising must be a no-op. A position whose numbers get clamped on
      // the way in would mean the screen names one thing and the run uses
      // another.
      expect(normalizePerformanceThresholds(thresholds), position).toEqual(thresholds);
      expect(exactSensitivity(thresholds)).toBe(position);
    }
  });

  it("moves every limit in one direction as the control moves", () => {
    /**
     * A reader who moves the control towards "Everything" must never find that
     * some hidden number moved the other way. Asserted on the fields where
     * "more sensitive" has an unambiguous direction; `lowPerformance`,
     * `accessibility`, `bestPractices`, `seo`, `regressionFloor` and
     * `agentReadiness` are cutoffs, so more sensitive is higher, and the rest
     * are gates, so more sensitive is lower.
     */
    const higherIsMoreSensitive = new Set([
      "lowPerformance",
      "accessibility",
      "bestPractices",
      "seo",
      "regressionFloor",
      "agentReadiness",
    ]);
    for (const key of NUMERIC_KEYS) {
      const [low, normal, high] = SENSITIVITIES.map((position) => SENSITIVITY_THRESHOLDS[position][key]);
      const ordered = higherIsMoreSensitive.has(key)
        ? low <= normal && normal <= high
        : low >= normal && normal >= high;
      expect(ordered, `${key} does not move in one direction: ${low} / ${normal} / ${high}`).toBe(true);
    }
  });

  it("never resolves the savings gate to zero", () => {
    // At 0 the gate is off, `digestLimit` returns null, and there is nothing to
    // show under the control — a position that resolves to nothing cannot be
    // displayed, which is the whole reason "Everything" is 1 ms rather than 0.
    for (const position of SENSITIVITIES) {
      expect(digestLimit(SENSITIVITY_THRESHOLDS[position]), position).not.toBeNull();
    }
    // And the three are distinguishable, so moving the control visibly moves
    // the limit rather than resolving two positions to one string.
    const shown = SENSITIVITIES.map((position) => digestLimit(SENSITIVITY_THRESHOLDS[position]));
    expect(new Set(shown).size).toBe(SENSITIVITIES.length);
  });

  it("is the same fact as the default threshold set", () => {
    expect(DEFAULT_PERFORMANCE_THRESHOLDS).toBe(SENSITIVITY_THRESHOLDS[DEFAULT_SENSITIVITY]);
  });
});

/* ── The limit the screen shows is the limit the digest wrote ───────────── */

const AT = "2026-08-04T09:00:00.000Z";
/**
 * Whoever marked the fix, named.
 *
 * F4 split the registry's `actor` — which classes MAY fire a transition — from
 * the record of who did, so a bare class no longer satisfies the guard. Nothing
 * here renders them; these limits are about cases, not about who moved them.
 */
const PERSON: Caller = { kind: "person", userId: "rae@webflow.com" };

function pageOf(): WatchPage {
  return { ...pendingPage("home", "Home", "https://www.example.com/", "watching"), lastRunAt: AT };
}

/**
 * A case the evaluator brought back, not one posed as already back.
 *
 * Built through `markFixed` and `recordCheckpointReading` for the same reason
 * `digest.test.ts` does: a hand-written checkpoint array can describe a shape
 * the lifecycle cannot produce, and a test that asserts against one proves
 * nothing about the digest a real run would write.
 */
function cameBackCase(): IssueCase {
  const posed: IssueCase = {
    id: "PW-1",
    cause: "c",
    state: "in_progress",
    title: "Unused JavaScript",
    diagnosis: "The homepage ships a bundle nothing on it uses.",
    detectedAt: AT,
    confirmedRuns: 2,
    scope: "pages",
    pageIds: ["home"],
    strategies: ["mobile"],
    impactMs: 1_800,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: ["Remove it."], actionability: "direct" },
    successCriteria: "Gone.",
    checkpoints: [],
    evidence: [],
    history: [],
  };
  return recordCheckpointReading(
    markFixed(posed, { by: PERSON, at: AT }),
    { interval: "7d", outcome: "disagreed", at: AT },
  ).issue;
}

describe("the limits shown under the control", () => {
  it("are the strings the digest writes, character for character", () => {
    /**
     * The VERIFY line this chunk exists to satisfy. `digestLimit` has two
     * readers — the digest's threshold clause and the settings screen — and
     * this asserts they are reading the same thing rather than two copies that
     * happen to agree today (rule 20).
     *
     * The clause is read out of a real built digest rather than out of
     * `digest-copy`, so a change to how the sentence is assembled fails here
     * too, not only a change to how the number is formatted.
     */
    for (const position of SENSITIVITIES) {
      const thresholds = SENSITIVITY_THRESHOLDS[position];
      const shown = digestLimit(thresholds);
      expect(shown, position).not.toBeNull();

      const digest = buildDigest({
        site: "example.com",
        date: "2026-08-04",
        cadence: "daily",
        pages: [pageOf()],
        thresholds,
        appUrl: "https://watch.example.com",
        cases: [cameBackCase()],
      });

      const line = digest.sections.find((section) => section.kind === "came_back")?.lines[0];
      expect(line, position).toBeDefined();
      expect(line!.text, position).toContain(`above the ${shown} you set`);
    }
  });

  it("is labelled by the screen and valued by the digest", () => {
    // The split is deliberate: S8 owns the noun, S7 owns the number. The label
    // must not contain the value, or it would be a second copy of it.
    expect(SETTINGS_SENSITIVITY_LIMIT_LABEL).not.toMatch(/\d/);
  });
});

/* ── Migration ──────────────────────────────────────────────────────────── */

function stateWith(thresholds?: Partial<PerformanceThresholds>): AppState {
  return {
    pages: [],
    recs: [],
    ...(thresholds ? { performanceThresholds: thresholds as PerformanceThresholds } : {}),
  };
}

describe("a site that tuned the twelve thresholds by hand", () => {
  it("maps to the nearest position rather than losing the configuration", () => {
    // Deliberately close to "Only big moves" without matching it: a bigger
    // savings gate, more confirming runs, both devices.
    const handTuned: Partial<PerformanceThresholds> = {
      ...SENSITIVITY_THRESHOLDS.low,
      regression: 22,
      minimumSavingsMs: 900,
    };
    expect(exactSensitivity(handTuned)).toBeNull();
    expect(nearestSensitivity(handTuned)).toBe("low");

    const state = normalizeState(stateWith(handTuned));
    expect(state.sensitivity).toBe("low");
    // The limits are the position's, not the hand-tuned ones. That is the cost
    // of the abstraction and it is why the reader is told.
    expect(state.performanceThresholds).toEqual(SENSITIVITY_THRESHOLDS.low);
  });

  it("is told once, in the digest footer, in the position's own words", () => {
    const state = normalizeState(stateWith({ ...SENSITIVITY_THRESHOLDS.high, minimumSavingsMs: 3 }));
    expect(state.sensitivityNotice).toBe(SENSITIVITY_LABEL.high);

    const digest = buildDigest({
      site: "example.com",
      date: "2026-08-04",
      cadence: "daily",
      cases: [],
      pages: [pageOf()],
      thresholds: normalizePerformanceThresholds(state.performanceThresholds),
      appUrl: "https://watch.example.com",
      notice: settingsMigrated(state.sensitivityNotice!),
    });
    expect(digest.footer.text).toContain(settingsMigrated(SENSITIVITY_LABEL.high));
    // It names the position, never the numbers it replaced: those are what the
    // reader no longer has a control for, and repeating them would only
    // describe something they cannot get back.
    expect(digest.footer.text).not.toContain("minimumSavingsMs");
  });

  it("says nothing to a site that never tuned anything", () => {
    expect(normalizeState(stateWith()).sensitivityNotice).toBeUndefined();
    expect(normalizeState(stateWith(SENSITIVITY_THRESHOLDS.normal)).sensitivityNotice).toBeUndefined();
    // Nor to a site that already has a position: the notice is for the
    // migration, and a stored position means the migration already happened.
    const settled: AppState = { ...stateWith(SENSITIVITY_THRESHOLDS.low), sensitivity: "low" };
    expect(normalizeState(settled).sensitivityNotice).toBeUndefined();
  });

  it("rewrites the limits from the position on every read", () => {
    // The position is the setting; the limits are its resolution. A stored set
    // that disagrees loses, or there would be two settings and only one of them
    // visible.
    const drifted: AppState = {
      ...stateWith({ ...SENSITIVITY_THRESHOLDS.normal, regression: 3 }),
      sensitivity: "normal",
    };
    expect(normalizeState(drifted).performanceThresholds).toEqual(SENSITIVITY_THRESHOLDS.normal);
  });
});

/* ── No threshold control outside /settings ─────────────────────────────── */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("where a threshold may be edited", () => {
  /**
   * One screen, and the check is structural rather than a promise in a comment.
   *
   * The twelve fields were deleted, not relocated, and the page-detail
   * calibration panel S3 removed is given no new home. What this asserts is
   * that nothing outside `/settings` and the sensitivity route can WRITE a
   * threshold: reading `performanceThresholds` is what half the app does, and
   * banning that would be banning the feature.
   */
  const writers = [
    "updatePerformanceThresholds",
    "updatePagePerformanceThresholds",
    "setPerformanceThresholds",
    "setPagePerformanceThresholdOverrides",
    "performanceThresholdOverrides",
  ];

  /**
   * The one place a retired name may still appear, and only to erase it.
   *
   * `normalizeState` deletes any stored `performanceThresholdOverrides` when it
   * reads state, because a value nothing can change and nothing should read is
   * worse left in the record than removed from it. Naming the exception here
   * rather than loosening the match keeps the check honest: a second file with
   * the same string still fails.
   */
  const ERASER = "lib/store/normalize.ts";

  it("is nowhere, for every retired writer", () => {
    const src = path.resolve(moduleDir, "../..");
    const offenders = sourceFiles(src)
      .filter((file) => writers.some((writer) => readFileSync(file, "utf8").includes(writer)))
      .map((file) => path.relative(src, file).split(path.sep).join("/"))
      .filter((file) => file !== ERASER);
    expect(offenders, "a retired threshold writer survives").toEqual([]);
  });

  it("leaves exactly one route that changes what is worth reporting", () => {
    const settingsRoutes = readdirSync(path.resolve(moduleDir, "../../app/api/settings"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(settingsRoutes).toContain("sensitivity");
    expect(settingsRoutes).not.toContain("performance-thresholds");
  });
});
