import type { DevicePolicy, PerformanceThresholds } from "./types";

/**
 * One control, three positions, and the limits each one resolves to.
 *
 * The decision this file records is option 10b, and the two rejected
 * alternatives are worth naming because both look reasonable from a distance:
 *
 *   - Twelve per-metric thresholds. Every number honest, and nobody could say
 *     what any of them would do to tonight's digest. A control whose effect can
 *     only be discovered by waiting a night is not a control.
 *   - No thresholds at all. Nothing to get wrong, and no answer to "why am I
 *     being told this" other than "the product decided". The digest's threshold
 *     clause — "above the 250 ms you set" — is the whole reason a reader trusts
 *     the line, and it needs a setting behind it to be true.
 *
 * So: one control, and the limits it resolves to are shown beneath it in the
 * words the digest will use. The abstraction is never opaque, which is the only
 * thing that makes an abstraction over twelve numbers honest rather than
 * convenient.
 *
 * Nothing here is per-page. S3 removed the page-detail calibration panel and
 * this chunk gives it no new home: a site has one answer to "what is worth
 * telling you", because the digest that asks the question is one message per
 * site. A per-page override would mean a digest whose limits differ line by
 * line, and the clause would have to name which limit it meant.
 *
 * This module imports nothing but the shape it fills in, so
 * `performanceThresholds.ts` can read the Normal position as its default
 * without the two importing each other.
 */

export const SENSITIVITIES = ["low", "normal", "high"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/**
 * Normal, until a site says otherwise.
 *
 * It is also `DEFAULT_PERFORMANCE_THRESHOLDS`. That is not a coincidence to be
 * tidied away later: a default threshold set and a default sensitivity position
 * are one fact, and two statements of it would drift the first time somebody
 * tuned one (rule 20).
 */
export const DEFAULT_SENSITIVITY: Sensitivity = "normal";

/**
 * The middle position, stated in full. The other two are stated as their
 * difference from it, so what sensitivity actually varies is readable here
 * rather than reconstructable by diffing three literals.
 */
/**
 * Frozen, so a caller that edits a resolved set fails loudly instead of
 * silently retuning every project in the process. `thresholdsFor` hands out
 * copies for exactly that reason; this is the mechanism behind the promise
 * rather than a comment asking the next editor to keep it (rule 20).
 */
const NORMAL: PerformanceThresholds = Object.freeze({
  lowPerformance: 60,
  regression: 15,
  improvement: 5,
  confirmationRuns: 1,
  devicePolicy: "either" satisfies DevicePolicy,
  accessibility: 90,
  bestPractices: 90,
  seo: 90,
  regressionFloor: 95,
  agentReadiness: 100,
  newPageGraceRuns: 2,
  minimumFindingRuns: 1,
  // Deliberately not 0. At 0 the savings gate is off, and a gate that is off is
  // a limit the reader did not set — so `thresholdOf` withholds the digest's
  // threshold clause entirely and there is nothing to display under the
  // control. "Everything" is expressed as a 1 ms limit rather than as no limit
  // for the same reason: a position that resolves to nothing cannot be shown.
  minimumSavingsMs: 250,
  minimumSavingsKilobytes: 25,
});

/**
 * The resolved limits at each position.
 *
 * Every field moves in one direction as the control moves, and that is the
 * invariant worth stating: a reader who moves the control towards "Everything"
 * must never find that some hidden number moved the other way. The parity test
 * asserts it on the fields where "more sensitive" has an unambiguous direction.
 */
export const SENSITIVITY_THRESHOLDS: Record<Sensitivity, PerformanceThresholds> = {
  low: Object.freeze({
    ...NORMAL,
    lowPerformance: 50,
    regression: 25,
    improvement: 10,
    confirmationRuns: 2,
    // Both devices must agree before a page changes status. The strictest of
    // the three device policies, which is what "only big moves" means when the
    // two devices disagree.
    devicePolicy: "both",
    accessibility: 80,
    bestPractices: 80,
    seo: 80,
    regressionFloor: 90,
    agentReadiness: 90,
    newPageGraceRuns: 3,
    minimumFindingRuns: 2,
    minimumSavingsMs: 1000,
    minimumSavingsKilobytes: 100,
  }),
  normal: NORMAL,
  high: Object.freeze({
    ...NORMAL,
    lowPerformance: 75,
    regression: 5,
    improvement: 1,
    confirmationRuns: 1,
    accessibility: 95,
    bestPractices: 95,
    seo: 95,
    regressionFloor: 100,
    agentReadiness: 100,
    newPageGraceRuns: 1,
    minimumFindingRuns: 1,
    // One millisecond, not zero. A saving smaller than a millisecond is not a
    // reading `formatImpact` can write, so this is every measurement there is —
    // and unlike 0 it is a limit the digest can name.
    minimumSavingsMs: 1,
    minimumSavingsKilobytes: 1,
  }),
};

export function isSensitivity(value: unknown): value is Sensitivity {
  return typeof value === "string" && (SENSITIVITIES as readonly string[]).includes(value);
}

/** An unset or unrecognised position reads as the default rather than as nothing. */
export function normalizeSensitivity(value: unknown): Sensitivity {
  return isSensitivity(value) ? value : DEFAULT_SENSITIVITY;
}

/**
 * The limits a position resolves to. The one place anything reads them.
 *
 * A copy, because the result goes into persisted state: a caller that edited
 * the returned object would be editing the position itself, for every project
 * in the process.
 */
export function thresholdsFor(sensitivity: Sensitivity): PerformanceThresholds {
  return { ...SENSITIVITY_THRESHOLDS[sensitivity] };
}

/* ── Migration ──────────────────────────────────────────────────────────── */

type NumericKey = Exclude<keyof PerformanceThresholds, "devicePolicy">;

const NUMERIC_KEYS = (Object.keys(NORMAL) as Array<keyof PerformanceThresholds>)
  .filter((key): key is NumericKey => key !== "devicePolicy");

/**
 * How far apart the three positions put one field.
 *
 * The distance metric below divides by this rather than by the field's allowed
 * range, and the difference matters. `regressionFloor` is legal from 1 to 100
 * but sensitivity only ever moves it between 90 and 100, so a stored 95 is
 * dead centre of what this control varies and nowhere near the middle of what
 * the field permits. Measuring against the range would let a field sensitivity
 * barely touches outvote one it swings across.
 */
function spanOf(key: NumericKey): number {
  const values = SENSITIVITIES.map((position) => SENSITIVITY_THRESHOLDS[position][key]);
  return Math.max(...values) - Math.min(...values);
}

/**
 * The position a hand-tuned threshold set is closest to.
 *
 * Registry rule 18's cousin: a configuration somebody spent time on is a
 * reading, and discarding it because it no longer has a control is exactly the
 * silent loss this product exists to stop. So it is mapped rather than dropped,
 * and `settingsMigrated` says so once, in the digest footer, in the reader's
 * own vocabulary — the position it became, not the numbers it was.
 *
 * Fields the three positions agree on are skipped: they carry no information
 * about which position was meant, and including them would flatten every real
 * difference towards nothing. A set that differs from all three only on such a
 * field is equidistant, and lands on the default.
 */
export function nearestSensitivity(thresholds: Partial<PerformanceThresholds> | undefined): Sensitivity {
  if (!thresholds) return DEFAULT_SENSITIVITY;
  const distanceTo = (position: Sensitivity): number => {
    const resolved = SENSITIVITY_THRESHOLDS[position];
    let total = 0;
    for (const key of NUMERIC_KEYS) {
      const span = spanOf(key);
      if (span === 0) continue;
      const value = thresholds[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      total += Math.abs(value - resolved[key]) / span;
    }
    if (thresholds.devicePolicy && thresholds.devicePolicy !== resolved.devicePolicy) total += 1;
    return total;
  };
  // The default is considered first and ties are kept, so an equidistant set
  // lands on Normal rather than on whichever position happens to sort first.
  let nearest: Sensitivity = DEFAULT_SENSITIVITY;
  let best = distanceTo(DEFAULT_SENSITIVITY);
  for (const position of SENSITIVITIES) {
    if (position === DEFAULT_SENSITIVITY) continue;
    const distance = distanceTo(position);
    if (distance < best) {
      best = distance;
      nearest = position;
    }
  }
  return nearest;
}

/**
 * The position a threshold set already IS, or null when it is hand-tuned.
 *
 * This is what decides whether anybody is told anything. A stored set that
 * matches a position exactly was produced by this control and needs no notice;
 * one that does not was produced by the twelve fields this chunk deletes, and
 * its owner is owed the sentence.
 */
export function exactSensitivity(thresholds: Partial<PerformanceThresholds> | undefined): Sensitivity | null {
  if (!thresholds) return null;
  return SENSITIVITIES.find((position) => {
    const resolved = SENSITIVITY_THRESHOLDS[position];
    return thresholds.devicePolicy === resolved.devicePolicy
      && NUMERIC_KEYS.every((key) => thresholds[key] === resolved[key]);
  }) ?? null;
}
