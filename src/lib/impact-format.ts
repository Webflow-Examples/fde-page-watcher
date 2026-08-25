import { hasMeasuredImpact } from "./issue-case";

/**
 * How an impact reading is written, for every surface that writes one.
 *
 * This used to live in `issue-row.tsx`, which was fine while the list was the
 * only thing that rendered a saving. The case detail renders the same figure,
 * and "Not measured" is in S2's locked copy list — so a second literal on the
 * case would have been two copies of one string, drifting the first time
 * someone reworded one of them (rule 20). The copy list documents the string;
 * this module owns it.
 */

/**
 * A measured saving, in the unit it was measured in.
 *
 * An unmeasured case says so in words. Registry rule 18: a finding with no
 * reading is never shown as 0 and never as a blank cell — either would let it
 * read as a very small saving, and an empty cell would let it outrank a
 * 1,900 ms finding on nothing at all. "Not measured" is the reading.
 */
export function formatImpact(impactMs: number): { text: string; measured: boolean } {
  if (!hasMeasuredImpact(impactMs)) return { text: "Not measured", measured: false };
  if (impactMs < 1000) return { text: `${impactMs} ms`, measured: true };
  const seconds = impactMs / 1000;
  const rounded = seconds >= 10 ? Math.round(seconds).toString() : seconds.toFixed(1).replace(/\.0$/, "");
  return { text: `${rounded} s`, measured: true };
}

/**
 * The same reading, on a group of cases rather than one.
 *
 * "up to", because a group carries the worst reading any member produced and
 * never a total (rule 19) — the number under this label is the one on one of
 * the rows beneath it, which is what makes the two reconcilable.
 */
export function formatGroupImpact(impactMs: number): { text: string; measured: boolean } {
  const impact = formatImpact(impactMs);
  return impact.measured ? { text: `up to ${impact.text}`, measured: true } : impact;
}
