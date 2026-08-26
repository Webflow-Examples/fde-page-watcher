import {
  AGENT_RESULT_LABEL,
  AGENT_VERDICT_LABEL,
  type AgentResult,
  type AgentVerdict,
  type ExclusionReason,
} from "./vocabulary";
import type { AgentHalf, AgentUnknownCause } from "./agent-access";

/**
 * The words Agent access says, in one place.
 *
 * Locked copy from the S4 brief. Two things here are deliberately NOT restated:
 *
 *   - the four verdict words and the six result words. `AGENT_VERDICT_LABEL`
 *     and `AGENT_RESULT_LABEL` already carry them from the registry, and a
 *     second copy of a word the registry owns is the defect rule 20 names — it
 *     drifts the moment somebody relabels one of the ten. The sentences below
 *     interpolate those maps rather than spelling the words out again.
 *   - the exclusion reasons. `EXCLUSION_REASONS` owns them, and the type of
 *     `agentExcluded` is the registry's union, so a reason this screen invents
 *     will not compile.
 *
 * The two cause sentences are the whole of the reach/comprehension split. They
 * carry what a second verdict would have carried — which half is at fault —
 * without adding a second concept for a reader to hold.
 */

export const AGENT_TITLE = "Agent access";

/* ── The subline: which half is at fault ────────────────────────────────── */

export const AGENT_CAUSE: Record<AgentHalf, string> = {
  reach: "Agents cannot reach the origin.",
  comprehension: "Agents reach it but cannot parse the content.",
};

/* ── Unknown, and which of its two causes ───────────────────────────────── */

export const AGENT_UNKNOWN: Record<AgentUnknownCause, string> = {
  disagree: "Two systems disagree about whether agents can reach this origin.",
  no_reading: "No reading could be taken, so there is nothing to conclude yet.",
};

/* ── Labels ─────────────────────────────────────────────────────────────── */

export const AGENT_LAST_CHECKED = "Last checked";
export const AGENT_NEXT_ACTION = "Next action";
export const AGENT_READINGS_LABEL = "Every reading";

/* ── The readings table ─────────────────────────────────────────────────── */

/** How many sources the table holds, and the promise that goes with it. */
export function agentReadingsCount(sources: number): string {
  return `${sources} sources · never averaged`;
}

/**
 * Why the verdict reads the way it does when the sources agree.
 *
 * A count of rows and the word those rows carry, both of which a reader can
 * check against the table directly above. That is the property the percentage
 * this replaces did not have.
 */
export function agentReadingsAgree(
  readings: number,
  result: AgentResult,
  verdict: AgentVerdict,
): string {
  return `${readings} ${AGENT_RESULT_LABEL[result]} readings and no disagreement, so the verdict is ${AGENT_VERDICT_LABEL[verdict]}.`;
}

/**
 * Why the verdict reads Unknown when they do not.
 *
 * Names both systems, because "sources disagree" without saying which two is a
 * sentence a reader cannot act on. The word Unknown is the registry's, taken
 * from the map rather than typed again.
 */
export function agentReadingsConflict(a: string, b: string): string {
  return `${a} and ${b} disagree, so the verdict is ${AGENT_VERDICT_LABEL.unknown}. Both readings are above.`;
}

/**
 * What an excluded source's row says.
 *
 * "Last reading kept" is the point of the sentence: applicability decides
 * whether a reading counts, never whether it is shown. A row that disappeared
 * on exclusion would be deleting evidence, which is the failure the concept
 * exists to prevent.
 */
export function agentExcluded(reason: ExclusionReason): string {
  return `Excluded — ${reason}. Last reading kept.`;
}
