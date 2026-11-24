/**
 * Numbers, in the one way this app writes them.
 *
 * A leaf module: it imports the measurement predicates from `issue-case/core`
 * and nothing else in the app imports it for anything but formatting. It is not
 * inside `impact-format.ts` because the case adapter needs the same words to
 * write an evidence line, and `impact-format` imports `issue-case` — importing it
 * back from there would close a cycle for two strings. The second copy of
 * "Not measured" is exactly what this module exists to prevent (rule 20), and
 * `impact-format` re-exports everything here so existing callers keep one name.
 */

import { hasMeasuredBytes, hasMeasuredImpact, type ImpactOrigin } from "./issue-case/core";

/**
 * The one way the app says a reading is absent.
 *
 * Rule 18 applies to every reading, not only to a saving in milliseconds, so
 * the string is exported rather than inlined: the pages inventory says it about
 * a score delta, and health has the same gap — a page with no baseline has no
 * health verdict, and the chip that would carry one says this instead. Same
 * sentence, one statement of it (rule 20).
 */
export const NOT_MEASURED = "Not measured";

/**
 * A measured saving, in the unit it was measured in.
 *
 * An unmeasured case says so in words. Registry rule 18: a finding with no
 * reading is never shown as 0 and never as a blank cell — either would let it
 * read as a very small saving, and an empty cell would let it outrank a
 * 1,900 ms finding on nothing at all. "Not measured" is the reading.
 */
export function formatImpact(impactMs: number): { text: string; measured: boolean } {
  if (!hasMeasuredImpact(impactMs)) return { text: NOT_MEASURED, measured: false };
  if (impactMs < 1000) return { text: `${impactMs} ms`, measured: true };
  const seconds = impactMs / 1000;
  const rounded = seconds >= 10 ? Math.round(seconds).toString() : seconds.toFixed(1).replace(/\.0$/, "");
  return { text: `${rounded} s`, measured: true };
}

/**
 * A measured byte saving, in binary units.
 *
 * A transfer size is counted in binary bytes, so this rounds the way the byte
 * figures elsewhere in the app do, and it says "KB"/"MB" because that is what
 * `formatDiagnosticImpact` writes into `savings` and what `parseImpactBytes`
 * reads back. A second spelling of one unit is how a label stops round-tripping.
 */
export function formatBytes(bytes: number): { text: string; measured: boolean } {
  if (!hasMeasuredBytes(bytes)) return { text: NOT_MEASURED, measured: false };
  if (bytes < 1024) return { text: `${Math.round(bytes)} B`, measured: true };
  const kb = bytes / 1024;
  if (kb < 1024) return { text: `${Math.round(kb)} KB`, measured: true };
  const mb = kb / 1024;
  return { text: `${mb >= 10 ? Math.round(mb) : mb.toFixed(1).replace(/\.0$/, "")} MB`, measured: true };
}

/**
 * What a case's impact cell reads: a time when one was measured, bytes when
 * only bytes were, and "Not measured" only when neither exists.
 *
 * One function for the list row, the case detail and the ticket. They used to
 * derive this separately — the row reduced the case to `impactMs`, the detail
 * went through `formatCaseImpact` — which is how a 579 KiB image finding showed
 * as an empty cell on the list and "Not measured" on the case while being the
 * same reading.
 */
export interface ImpactReading {
  text: string;
  measured: boolean;
  /** Which measurement the text states. `none` carries `NOT_MEASURED`. */
  unit: "time" | "bytes" | "none";
  /** Who took the reading, when the case records it. */
  origin?: ImpactOrigin;
}

/** The `ImpactReading` for a bare impact — a case, a group or a stored record. */
export function impactReading(impact: {
  impactMs: number;
  impactBytes?: number;
  impactOrigin?: ImpactOrigin;
}): ImpactReading {
  // Milliseconds first: a case measured in both reads its time, and the byte
  // figure stays in the evidence rather than being added to it (rule 19).
  if (hasMeasuredImpact(impact.impactMs)) {
    return {
      ...formatImpact(impact.impactMs),
      unit: "time",
      ...(impact.impactOrigin ? { origin: impact.impactOrigin } : {}),
    };
  }
  if (hasMeasuredBytes(impact.impactBytes)) {
    return {
      ...formatBytes(impact.impactBytes ?? 0),
      unit: "bytes",
      ...(impact.impactOrigin ? { origin: impact.impactOrigin } : {}),
    };
  }
  return { text: NOT_MEASURED, measured: false, unit: "none" };
}

/**
 * The quiet label beside a reading, saying who measured it.
 *
 * "Real users" rather than "Observed", because the distinction a reader needs is
 * whether visitors experienced this or whether a test simulated it. Null when the
 * case records no origin, which is common for cases whose impact was supplied by
 * an adapter rather than measured — rule 18 again: say nothing rather than
 * invent a voice.
 */
export function impactOriginLabel(origin: ImpactOrigin | undefined): string | null {
  if (origin === "observed") return "Real users";
  if (origin === "simulated") return "Simulated";
  return null;
}

/**
 * The same reading, on a group of cases rather than one.
 *
 * "up to", because a group carries the worst reading any member produced and
 * never a total (rule 19) — the number under this label is the one on one of
 * the rows beneath it, which is what makes the two reconcilable. The group's
 * origin travels with it, so a header does not label a simulated aggregate
 * "Real users".
 */
export function formatGroupImpact(impactMs: number): { text: string; measured: boolean } {
  const impact = formatImpact(impactMs);
  return impact.measured ? { text: `up to ${impact.text}`, measured: true } : impact;
}

/** A group's reading: worst time, else worst bytes, worded as a worst-of. */
export function groupImpactReading(group: {
  impactMs: number;
  impactBytes?: number;
  impactOrigin?: ImpactOrigin;
}): ImpactReading {
  const reading = impactReading(group);
  return reading.measured ? { ...reading, text: `up to ${reading.text}` } : reading;
}
