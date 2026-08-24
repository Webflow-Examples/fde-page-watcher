import type { CollectResult } from "../../psiCore";
import type { NightScores } from "../../types";

/**
 * Build a complete `CollectResult` for tests.
 *
 * Several suites only care about scores and sample size, but the real type also
 * carries schema version, findings, per-run evidence, and collection quality.
 * Hand-rolled partial fakes drifted out of step with it, so this fills in
 * realistic defaults and lets a test override only what it is asserting on.
 */
export function collectResult(
  scores: NightScores,
  overrides: Partial<CollectResult> = {},
): CollectResult {
  return {
    schemaVersion: 2,
    scores,
    opportunities: [],
    findings: [],
    runEvidence: [],
    quality: {
      requestedRuns: 5,
      successfulRuns: 5,
      eligibleRuns: 5,
      warnedRuns: 0,
      failedRuns: 0,
      findingsObserved: 0,
      findingsPromoted: 0,
      status: "reliable",
    },
    sampleSize: 5,
    raws: [],
    ...overrides,
  };
}
