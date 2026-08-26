/**
 * Agent access, as one conclusion and five readings.
 *
 * The screen this feeds answers one question — can agents use this origin —
 * and it answers it with a word, not a number. Everything a reader could
 * otherwise average is kept apart on purpose:
 *
 *   1. One verdict per origin, from the registry's `agent_verdict`. There is
 *      no second verdict, no score, no percentage, and no provider stack. The
 *      type below is a discriminated union rather than a bag of optional
 *      fields, so a verdict that needs a subline cannot be built without one.
 *   2. One row per source, and never a row that is two sources added up. The
 *      only reduction that happens inside a row is the worst reading that
 *      source itself took, which is registry rule 19 — the same statistic for
 *      a group as for one member, never a sum and never a mean.
 *   3. A source that was excluded keeps its row, its last reading and its
 *      reason. Excluding is not deleting; that is the whole of the
 *      applicability concept, and hiding evidence without saying why is what
 *      cost the old agent tab its trust.
 *
 * Nothing user-facing is authored here. Result and verdict words come from
 * `vocabulary.ts`; the sentences come from `agent-copy.ts`; the words in the
 * `words` field are the source's own, carried through from its reading.
 */

import {
  EVIDENCE_SOURCES,
  type AgentResult,
  type AgentVerdict,
  type EvidenceSource,
  type ExclusionReason,
} from "./vocabulary";
import {
  determinedAgentIssueCases,
  disputedAgentIssueCases,
  type AgentEvidenceSystem,
  type AgentHalf,
  type AgentIssueCase,
  type AgentIssueSource,
  type AgentIssueStatus,
} from "./agentIssueCases";
import { EVIDENCE_SOURCE_FOR_AGENT_SYSTEM } from "./issue-case";
import type { NativeElementScan } from "./types";

export type { AgentHalf };

/**
 * Why the verdict is Unknown. Two causes, and the screen must say which.
 *
 * They are not interchangeable: `no_reading` means nobody measured, so there is
 * nothing to conclude yet; `disagree` means two systems measured and came back
 * with opposite answers, so there is something to look at right now. Collapsing
 * them into one "Unknown" is how a live contradiction reads as an idle queue.
 */
export type AgentUnknownCause = "no_reading" | "disagree";

/**
 * The sources that can say something about agent access, in the order the
 * readings table shows them.
 *
 * Five of the registry's six evidence slots. `crux` is the one omission and it
 * is deliberate: the Chrome UX Report is field data from real Chrome users, so
 * it has no reading to offer about a client that is not a browser. Leaving it
 * out of this list is a statement that it was considered, not that it was
 * forgotten — `agent-access.test.ts` asserts the five against
 * `EVIDENCE_SOURCES` and asserts that `crux` is the only slot missing.
 */
export const AGENT_ACCESS_SOURCES = [
  "agent-readiness",
  "ora",
  "kitesurf",
  "native-elements",
  "lighthouse",
] as const;
export type AgentAccessSource = (typeof AGENT_ACCESS_SOURCES)[number];

/**
 * The registry's result word for one of the assembler's statuses.
 *
 * A `Record` over the union rather than a chain of ternaries, so a status added
 * to `AgentIssueStatus` is a compile error here instead of quietly falling
 * through to whatever the last branch said. This is also the one place the two
 * spellings meet: the assembler's `pass` / `not-applicable` are the registry's
 * `passed` / `not_applicable`, and no other module is allowed to bridge them.
 */
export const AGENT_RESULT_FOR_STATUS: Record<AgentIssueStatus, AgentResult> = {
  pass: "passed",
  partial: "partial",
  failed: "failed",
  "not-applicable": "not_applicable",
  unavailable: "unavailable",
  ignored: "ignored",
};

/**
 * Worst first. Used only to pick which of one source's own readings represents
 * that source, never to combine two sources: an absent or excluded reading
 * sorts behind every determined one rather than counting as good news.
 */
const RESULT_SEVERITY: Record<AgentResult, number> = {
  failed: 0,
  partial: 1,
  unavailable: 2,
  ignored: 3,
  not_applicable: 4,
  passed: 5,
};

interface AgentReadingBase {
  source: AgentAccessSource;
  result: AgentResult;
  /**
   * The source's own words for what it saw — check names, the provider's own
   * detail, the probe's HTTP status, the scan's own failure reason. Absent when
   * the source produced no words of its own, in which case the row says so
   * rather than borrowing a sentence from somewhere else.
   */
  words?: string;
  /** The source's own date. Never the run's, never the newest of the five. */
  observedAt?: string;
}

/**
 * One row of the readings table.
 *
 * A union rather than an optional `reason`, because the registry requires a
 * reason on every exclusion. Written this way, a source cannot be marked
 * excluded without one — the requirement is a type error rather than a comment
 * asking the next editor to remember.
 */
export type AgentReading =
  | (AgentReadingBase & { applicability: "included" })
  | (AgentReadingBase & { applicability: "excluded"; reason: ExclusionReason });

/** The one case named as most responsible, and its first step. */
export interface AgentPrimary {
  /** Issue family key. The screen resolves it to a case id for the link. */
  key: string;
  title: string;
  nextAction: string;
}

interface AgentAccessBase {
  /** Exactly `AGENT_ACCESS_SOURCES`, in that order. No aggregate row. */
  readings: readonly AgentReading[];
  /**
   * The newest date any included source read this origin, or undefined when
   * nothing has been read. Not optional at the point of render: the component
   * that paints the verdict word takes this in the same call, so a verdict
   * cannot reach the screen without a last-checked line beside it.
   */
  lastChecked?: string;
}

/**
 * One verdict per origin.
 *
 * The shape carries the requirement. `needs_work` and `blocked` cannot exist
 * without the half at fault, and `unknown` cannot exist without saying which of
 * its two causes applies — so "a needs_work verdict names reach or
 * comprehension, not both and not neither" is a fact about the type rather than
 * a rule somebody has to keep.
 *
 * `fault` is deliberately not a second verdict. It selects one of two sentences
 * under the first verdict, which is what the deferred reach/comprehension split
 * would have carried; a real second verdict needs an amendment to
 * `agent_verdict` in `vocabulary.json`.
 *
 * Each branch names its verdict through `Extract<AgentVerdict, …>` rather than
 * as a bare string, so the four words are the registry's four words. A key
 * renamed there makes its branch uninhabitable and every place that returns it
 * stops compiling, instead of leaving this module quietly spelling a verdict
 * the registry no longer has.
 */
export type AgentAccess = AgentAccessBase & (
  | { verdict: Extract<AgentVerdict, "ready">; primary: null }
  | { verdict: Extract<AgentVerdict, "needs_work" | "blocked">; fault: AgentHalf; primary: AgentPrimary }
  | { verdict: Extract<AgentVerdict, "unknown">; cause: "no_reading"; primary: null }
  | {
    verdict: Extract<AgentVerdict, "unknown">;
    cause: "disagree";
    /** The two rows that contradict each other, so the screen can adjoin them. */
    disagreement: readonly [AgentReading, AgentReading];
    primary: null;
  }
);

export interface AgentAccessInput {
  /**
   * Every assembled issue case for this origin, worst first.
   *
   * Kitesurf is deliberately not a separate input here. Its probe reaches the
   * assembler, becomes a reading on `agent-access:reachability`, and arrives
   * through the cases like Page Watch's and Ora's do — which is the only way it
   * can agree or disagree with them. A second path in would have given the
   * kitesurf row a value the disagreement check could not see.
   */
  cases: readonly AgentIssueCase[];
  /** Latest published-HTML scan in range, with the night it was taken on. */
  nativeElements?: { scan: NativeElementScan; observedAt?: string } | null;
  /**
   * Latest Lighthouse run in range. Only its date is used: see
   * `lighthouseReading` for why Lighthouse has no agent-access result to give.
   */
  lighthouse?: { observedAt?: string } | null;
  /**
   * Sources the user has taken out of this origin's results, with the reason.
   *
   * Modelled and rendered, with no producer wired in here on purpose. S8 owns
   * exclusions end to end — the excluded list, the control that writes a reason,
   * and `settings-exclusions.ts`, which already resolves a stored string to a
   * decided reason for that record. A resolver here would be a second opinion
   * about what a valid reason is, and the two would disagree the day the
   * registry changes.
   *
   * What this input guarantees is the render: whenever S8 hands the panel a
   * source-level exclusion, the row stays, greys, and carries its reason and its
   * last reading. Dropping the row instead would be the deletion the
   * applicability concept exists to prevent.
   *
   * The remaining seam is noted in DECISIONS.md 5: S8 resolves reasons from the
   * workspace defaults, and a page-level exclusion's reason has no reader yet.
   */
  excluded?: Partial<Record<AgentAccessSource, ExclusionReason>>;
}



/* ── Readings ───────────────────────────────────────────────────────────── */

function latest(dates: readonly (string | undefined)[]): string | undefined {
  return dates.filter((date): date is string => !!date).sort().at(-1);
}

/** The source's own words for one reading: its label, and its own detail. */
function wordsOf(source: AgentIssueSource): string {
  return source.detail ? `${source.label} — ${source.detail}` : source.label;
}

/**
 * One row for one system, from every reading that system took.
 *
 * The row shows that system's worst reading and the words behind it. That is a
 * selection, not an average: the number shown is one this source actually
 * produced, and it can always be found again in the case list underneath.
 */
function caseBackedReading(
  source: AgentAccessSource,
  system: AgentEvidenceSystem,
  cases: readonly AgentIssueCase[],
): AgentReadingBase {
  const readings = cases.flatMap((item) => item.sources.filter((entry) => entry.system === system));
  if (readings.length === 0) return { source, result: "unavailable" };
  const worst = readings.reduce((best, entry) =>
    RESULT_SEVERITY[AGENT_RESULT_FOR_STATUS[entry.result]]
      < RESULT_SEVERITY[AGENT_RESULT_FOR_STATUS[best.result]]
      ? entry
      : best);
  const result = AGENT_RESULT_FOR_STATUS[worst.result];
  const words = readings
    .filter((entry) => AGENT_RESULT_FOR_STATUS[entry.result] === result)
    .map(wordsOf)
    .join(" · ");
  const observedAt = latest(readings.map((entry) => entry.observedAt));
  return {
    source,
    result,
    ...(words ? { words } : {}),
    ...(observedAt ? { observedAt } : {}),
  };
}

/**
 * The published-HTML scan's reading.
 *
 * What this scan answers about agent access is narrow and worth stating
 * exactly: an ordinary HTTP client, running no JavaScript, asked this origin
 * for the published page and either got parseable markup back or did not. That
 * is a reach reading, and it is independent of everything else on the list
 * because it is a different fetcher. It is deliberately NOT read as a comment
 * on the content: the findings it collects are Webflow element footprints for
 * the performance surface, and turning those into an agent-access result would
 * be inventing a claim no scan made.
 */
function nativeElementsReading(
  input: AgentAccessInput["nativeElements"],
): AgentReadingBase {
  const source: AgentAccessSource = "native-elements";
  if (!input) return { source, result: "unavailable" };
  const { scan, observedAt } = input;
  if (scan.status !== "available") {
    return {
      source,
      result: "unavailable",
      // The scan's own reason, verbatim, or nothing. Rule 18: an absence says
      // so rather than being dressed up as an explanation.
      ...(scan.reason ? { words: scan.reason } : {}),
      ...(observedAt ? { observedAt } : {}),
    };
  }
  return {
    source,
    result: "passed",
    ...(scan.platform ? { words: scan.platform.signals.join(", ") } : {}),
    ...(observedAt ? { observedAt } : {}),
  };
}

/**
 * Lighthouse's reading, which is that it has none.
 *
 * Lighthouse runs four browser categories against this page. Not one of them
 * asks whether a non-browser client can reach or parse the origin, so the
 * honest result is the registry's `not_applicable` — and the SEO score, which
 * is the closest thing it has, stays off this screen because a number is
 * exactly what a verdict is not.
 *
 * The row is here rather than dropped so that a reader can see Lighthouse was
 * not quietly folded into the conclusion. It carries its own date for the same
 * reason: the run happened, and it said nothing about this.
 */
function lighthouseReading(input: AgentAccessInput["lighthouse"]): AgentReadingBase {
  const source: AgentAccessSource = "lighthouse";
  if (!input?.observedAt) return { source, result: "unavailable" };
  return { source, result: "not_applicable", observedAt: input.observedAt };
}

/**
 * The five rows, in the table's order, each carrying its own words and date.
 *
 * Exported so the screen and its tests read the same list. There is no sixth
 * row: an aggregate row is the thing this table exists instead of.
 */
export function agentReadings(input: AgentAccessInput): AgentReading[] {
  const base: Record<AgentAccessSource, AgentReadingBase> = {
    "agent-readiness": caseBackedReading("agent-readiness", "page-watch", input.cases),
    ora: caseBackedReading("ora", "ora", input.cases),
    kitesurf: caseBackedReading("kitesurf", "kitesurf", input.cases),
    "native-elements": nativeElementsReading(input.nativeElements),
    lighthouse: lighthouseReading(input.lighthouse),
  };
  return AGENT_ACCESS_SOURCES.map((source) => {
    const reason = input.excluded?.[source];
    // An excluded source keeps the reading it last took. Only the reason and
    // the greying are added — nothing is recomputed and nothing is dropped.
    return reason
      ? { ...base[source], applicability: "excluded" as const, reason }
      : { ...base[source], applicability: "included" as const };
  });
}

/* ── The verdict ────────────────────────────────────────────────────────── */

/**
 * A case is settled when the systems that determined a result agree with each
 * other. An unsettled case cannot carry a verdict on its own: registry rule for
 * confidence says any disagreement lands on unclear, and a majority does not
 * carry the conclusion.
 */
function settled(cases: readonly AgentIssueCase[]): AgentIssueCase[] {
  return cases.filter((item) => item.confidence !== "conflicting");
}

/** The two rows behind a disputed case: the one that saw a problem, and the one that did not. */
function disagreementRows(
  dispute: AgentIssueCase,
  readings: readonly AgentReading[],
): readonly [AgentReading, AgentReading] | null {
  const determined = dispute.sources.filter((entry) =>
    entry.result === "failed" || entry.result === "partial" || entry.result === "pass");
  const negative = determined.find((entry) => entry.result !== "pass");
  const positive = determined.find((entry) => entry.result === "pass");
  if (!negative || !positive) return null;
  // Which row a system writes to is stated once, in `issue-case.ts`, and read
  // back here. A second copy of that mapping is the drift rule 20 names.
  const rowFor = (system: AgentEvidenceSystem) =>
    readings.find((reading) => reading.source === EVIDENCE_SOURCE_FOR_AGENT_SYSTEM[system]);
  const a = rowFor(negative.system);
  const b = rowFor(positive.system);
  return a && b ? [a, b] : null;
}

/**
 * One verdict, one subline, five readings.
 *
 * The order of the branches below is the whole of the policy, so it is stated
 * rather than left to be reconstructed from the code:
 *
 *   1. A settled essential failure is Blocked. It comes first because it is
 *      measured bad news, and registry rule 18 is explicit that a claim
 *      withheld for want of data must never swallow a drop that was measured.
 *   2. Otherwise, two systems contradicting each other about REACH is Unknown.
 *      Reach is the precondition — if it is genuinely in doubt, nothing
 *      downstream of it can be concluded, which is exactly what the Unknown
 *      subline says. A contradiction on the comprehension half stays on its
 *      case, where the conflict sentence already shows both readings, and does
 *      not overturn readings that are settled.
 *   3. Otherwise, nothing determined anywhere is Unknown for the other reason.
 *   4. Otherwise, a settled failure or partial is Needs work.
 *   5. Otherwise, Ready.
 */
export function agentAccess(input: AgentAccessInput): AgentAccess {
  const readings = agentReadings(input);
  const included = readings.filter((reading) => reading.applicability === "included");
  const lastChecked = latest(included.map((reading) => reading.observedAt));
  const base = { readings, ...(lastChecked ? { lastChecked } : {}) };

  const cases = input.cases;
  const stable = settled(cases);
  const blockers = stable.filter((item) => item.status === "failed" && item.tier === "essential");
  const failing = stable.filter((item) => item.status === "failed" || item.status === "partial");
  const reachDisputes = disputedAgentIssueCases(cases).filter((item) => item.half === "reach");

  const primaryOf = (item: AgentIssueCase): AgentPrimary => ({
    key: item.key,
    title: item.title,
    // The first step of the one case named most responsible. Never a list of
    // six causes: the screen links to that case, where the rest of them are.
    nextAction: item.remediation[0] ?? "",
  });

  if (blockers[0]) {
    return { ...base, verdict: "blocked", fault: blockers[0].half, primary: primaryOf(blockers[0]) };
  }

  for (const dispute of reachDisputes) {
    const rows = disagreementRows(dispute, readings);
    if (rows) return { ...base, verdict: "unknown", cause: "disagree", disagreement: rows, primary: null };
  }

  if (determinedAgentIssueCases(cases).length === 0) {
    return { ...base, verdict: "unknown", cause: "no_reading", primary: null };
  }

  if (failing[0]) {
    return { ...base, verdict: "needs_work", fault: failing[0].half, primary: primaryOf(failing[0]) };
  }

  return { ...base, verdict: "ready", primary: null };
}

/* ── The agreement line under the table ─────────────────────────────────── */

export interface AgentAgreement {
  /** How many included rows carry the result the verdict rests on. */
  count: number;
  result: AgentResult;
}

/**
 * Which reading the verdict rests on, and how many rows say it.
 *
 * A count of rows, not a score out of them: "3 Passed readings" is checkable
 * against the table above it, which is the property a percentage does not have.
 */
export function agentAgreement(access: AgentAccess): AgentAgreement {
  const included = access.readings.filter((reading) => reading.applicability === "included");
  const determined = included.filter((reading) =>
    reading.result === "failed" || reading.result === "partial" || reading.result === "passed");
  const pool = determined.length ? determined : included;
  const result = pool.reduce<AgentResult>(
    (worst, reading) => RESULT_SEVERITY[reading.result] < RESULT_SEVERITY[worst] ? reading.result : worst,
    "passed",
  );
  return { count: pool.filter((reading) => reading.result === result).length, result };
}

/* ── Registry parity ────────────────────────────────────────────────────── */

/**
 * Re-exported so the parity test can assert the five against the registry's six
 * without importing the registry twice.
 */
export const ALL_EVIDENCE_SOURCES: readonly EvidenceSource[] = EVIDENCE_SOURCES;

/** The one slot deliberately left out of this screen, and nothing else. */
export const AGENT_ACCESS_SOURCE_OMISSIONS: readonly EvidenceSource[] = ["crux"];

/** Kept as a type-level assertion that the five are all real registry slots. */
export const AGENT_ACCESS_SOURCE_SLOT: Record<AgentAccessSource, EvidenceSource> = {
  "agent-readiness": "agent-readiness",
  ora: "ora",
  kitesurf: "kitesurf",
  "native-elements": "native-elements",
  lighthouse: "lighthouse",
};

/** The ledger slot each assembler system writes to, re-exported for the tests. */
export { EVIDENCE_SOURCE_FOR_AGENT_SYSTEM };
