import { AGENT_CHECK_GROUPS, ALL_AGENT_CHECKS } from "./agentChecks";
import { agentCheckKey, agentExclusionKey, normalizeAgentIgnoreSettings } from "./agentScoring";
import { formatImpact, NOT_MEASURED } from "./impact-format";
import { excludedPageIds, exclusionReasonOf, type IssueCase } from "./issue-case";
import {
  nativeElementExclusionReason,
  nativeElementIssuesForPage,
} from "./nativeElements";
import type { AgentCheck, AppState, WatchPage } from "./types";
import { AGENT_RESULT_LABEL, EXCLUSION_REASONS, UNLABELLED_EXCLUSION_REASON, type ExclusionReason } from "./vocabulary";

/**
 * Everything this site has set aside, as one list.
 *
 * One list, not four, and the reason is the registry's: applicability is one
 * concept that "applies to agent checks, check groups, and native-element
 * findings alike", and S3 extended it to the pages a case covers. Four screens
 * for one concept is how a reader ends up with an exclusion they cannot find —
 * which is the failure the audit recorded when the agent tab hid evidence
 * without saying why, and the reason every row here carries its reason and its
 * last reading rather than just disappearing.
 *
 * Excluding is not deleting. A row keeps the last thing that was measured about
 * it, greyed and struck through on screen, so a reader can see both that it was
 * set aside and what it looked like when it was counted. Rule 18 applies as it
 * does everywhere: a row with no reading says "Not measured" rather than 0,
 * because an absent measurement is not a small one.
 *
 * What this module does NOT do is decide anything about sensitivity, ranking or
 * weight. A row is in or out; there is no third state and no ordering by
 * importance. The list sorts by kind and then alphabetically, which is the only
 * order that cannot be read as a judgement.
 */

export type ExcludedKind = "page" | "check";

/**
 * What Include has to call.
 *
 * A tagged union rather than a callback, so this module stays free of React and
 * of the store: it says which record is excluded, and the screen knows which
 * mutation owns that record.
 */
export type IncludeTarget =
  | { target: "native-element"; pageId: string; findingId: string }
  | { target: "agent-check"; scope: "check" | "group"; value: string }
  /**
   * Carries the case, not a key.
   *
   * The decision log is keyed on the remediation (F5), and `remediationKey` is
   * its single producer. Handing a precomputed key along a row would put a
   * second one in circulation — nothing could then tell a key this module made
   * from one a caller invented, which is the detachment F5's guard exists to
   * catch. So the case travels and the call site derives the key, where the
   * guard can see it.
   */
  | { target: "case-page"; issue: IssueCase; pageId: string };

export interface ExcludedRow {
  /** Stable across renders and unique across the kinds. */
  id: string;
  kind: ExcludedKind;
  /** What is excluded. */
  title: string;
  /** Where — the page a check sits on, or the case a page sits in. Null when it is site-wide. */
  scope: string | null;
  reason: ExclusionReason;
  /** Its last reading, in the words the app writes readings in. */
  reading: string;
  /** False when there is no reading, so the screen can say so rather than show a number. */
  measured: boolean;
  include: IncludeTarget;
}

/* ── Checks: agent-readiness ────────────────────────────────────────────── */

/**
 * The worst result this check last produced anywhere on the site.
 *
 * Rule 19: a figure standing for several pages is the worst reading one of them
 * produced, never a sum and never an average — so a check that failed on one
 * page reads Failed here even if it passed on nine others, and the row is
 * reconcilable with the pages beneath it.
 *
 * A check nothing has measured returns null rather than Passed. An exclusion
 * may well be why nothing measured it, and reporting that as a pass would be a
 * reading nobody took.
 */
function worstAgentResult(pages: readonly WatchPage[], matches: (check: AgentCheck) => boolean): string | null {
  let seen = false;
  let unavailable = false;
  for (const page of pages) {
    for (const check of page.agent ?? []) {
      if (!matches(check)) continue;
      if (check.unavailable) {
        unavailable = true;
        continue;
      }
      seen = true;
      if (!check.pass) return AGENT_RESULT_LABEL.failed;
    }
  }
  if (seen) return AGENT_RESULT_LABEL.passed;
  return unavailable ? AGENT_RESULT_LABEL.unavailable : null;
}

/**
 * The reason recorded against this exclusion, or the one it has always meant.
 *
 * A record written before the control asked for a reason carries none, and the
 * honest reading of that is not "no reason" but the state the toggle put it in
 * — see `UNLABELLED_EXCLUSION_REASON`. A stored string the registry does not
 * bless is treated the same way, on `normalizeNativeElementControls`' grounds:
 * a reason nobody decided is the absence of one.
 */
/**
 * The one gate between a stored string and this record's decided reason.
 *
 * `types.ts` cannot import the registry, so the stored field is a plain string
 * and whichever module owns the record narrows it. This module owns
 * `AgentIgnoreSettings.reasons`, so this is that narrowing — and it is the only
 * one for this record, in either direction. Writers and readers both call it rather than repeating the
 * membership test, because several spellings of one rule is the drift rule 20
 * names.
 *
 * Returns `null` for "not a reason this registry blesses", which is the same
 * answer as "no reason recorded": applicability requires a reason, and a reason
 * nobody decided is the absence of one. It never signals "the record is gone" —
 * that is the caller's question, not this one's.
 */
export function narrowAgentCheckExclusionReason(value: unknown): ExclusionReason | null {
  return typeof value === "string" && (EXCLUSION_REASONS as readonly string[]).includes(value)
    ? value as ExclusionReason
    : null;
}

function reasonFor(
  defaults: ReturnType<typeof normalizeAgentIgnoreSettings>,
  scope: "check" | "group",
  value: string,
): ExclusionReason {
  const stored = defaults.reasons?.[agentExclusionKey(scope, value)];
  return narrowAgentCheckExclusionReason(stored) ?? UNLABELLED_EXCLUSION_REASON;
}

function agentRows(state: AppState): ExcludedRow[] {
  const defaults = normalizeAgentIgnoreSettings(state.agentIgnoreDefaults);
  const groupRows = defaults.groups.flatMap((name): ExcludedRow[] => {
    if (!AGENT_CHECK_GROUPS.some((group) => group.name === name)) return [];
    const reading = worstAgentResult(state.pages, (check) => check.group === name);
    return [{
      id: `agent-group:${name}`,
      kind: "check",
      title: name,
      scope: null,
      reason: reasonFor(defaults, "group", name),
      reading: reading ?? NOT_MEASURED,
      measured: reading !== null,
      include: { target: "agent-check", scope: "group", value: name },
    }];
  });

  const checkRows = defaults.checks.flatMap((key): ExcludedRow[] => {
    const check = ALL_AGENT_CHECKS.find((candidate) => agentCheckKey(candidate) === key);
    if (!check) return [];
    // A check inside an excluded group is already covered by the group's row.
    // Two rows for one exclusion would make Include ambiguous.
    if (defaults.groups.includes(check.group)) return [];
    const reading = worstAgentResult(
      state.pages,
      (candidate) => candidate.group === check.group && candidate.name === check.name,
    );
    return [{
      id: `agent-check:${key}`,
      kind: "check",
      title: check.name,
      scope: check.group,
      reason: reasonFor(defaults, "check", key),
      reading: reading ?? NOT_MEASURED,
      measured: reading !== null,
      include: { target: "agent-check", scope: "check", value: key },
    }];
  });

  return [...groupRows, ...checkRows];
}

/* ── Checks: native-element findings ────────────────────────────────────── */

/**
 * How many of the element this page last had.
 *
 * A count is the reading a native-element finding produces — there is no
 * millisecond saving behind it — so it is written as a count rather than
 * converted into one. A finding excluded before it was ever seen in a scan has
 * no count and says so.
 */
function nativeRows(pages: readonly WatchPage[]): ExcludedRow[] {
  return pages.flatMap((page) => {
    const controls = page.nativeElementControls ?? {};
    const lifecycles = nativeElementIssuesForPage(page.history);
    return Object.keys(controls).flatMap((findingId): ExcludedRow[] => {
      const reason = nativeElementExclusionReason(controls, findingId);
      if (!reason) return [];
      const finding = lifecycles.find((candidate) => candidate.id === findingId);
      return [{
        id: `native:${page.id}:${findingId}`,
        kind: "check",
        title: finding?.title ?? findingId,
        scope: page.title,
        reason,
        reading: finding ? `${finding.count} ${finding.count === 1 ? "instance" : "instances"}` : NOT_MEASURED,
        measured: Boolean(finding),
        include: { target: "native-element", pageId: page.id, findingId },
      }];
    });
  });
}

/* ── Pages ──────────────────────────────────────────────────────────────── */

/**
 * A page a case does not apply to.
 *
 * The reading is the case's worst measured saving, which is the same figure the
 * case's own pages table shows against the row — not a per-page number this
 * module invents, because there is no per-page saving to invent one from.
 *
 * Real since F5: the exclusion is a decision in the log, applied by
 * `issueCasesFrom`, so these rows describe something a reader actually did
 * rather than a shape nothing could produce.
 */
function pageRows(cases: readonly IssueCase[], pageTitles: Record<string, string>): ExcludedRow[] {
  return cases.flatMap((issue) =>
    excludedPageIds(issue).flatMap((pageId): ExcludedRow[] => {
      const reason = exclusionReasonOf(issue, pageId);
      if (!reason) return [];
      const impact = formatImpact(issue.impactMs);
      return [{
        id: `case-page:${issue.id}:${pageId}`,
        kind: "page",
        title: pageTitles[pageId] ?? pageId,
        scope: issue.title,
        reason,
        reading: impact.text,
        measured: impact.measured,
        include: { target: "case-page", issue, pageId },
      }];
    })
  );
}

/* ── The list ───────────────────────────────────────────────────────────── */

/**
 * Pages first, then checks, each alphabetical.
 *
 * Not by severity, not by date, not by how much each one is costing. Any of
 * those would rank exclusions, and an exclusion has no rank: the reader already
 * decided each of these does not apply. An order that implied otherwise would
 * be the product arguing with a decision it was told about.
 */
export function excludedFromResults(
  state: AppState,
  cases: readonly IssueCase[] = [],
): ExcludedRow[] {
  const pageTitles = Object.fromEntries(state.pages.map((page) => [page.id, page.title]));
  const rows = [
    ...pageRows(cases, pageTitles),
    ...agentRows(state),
    ...nativeRows(state.pages),
  ];
  return rows.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "page" ? -1 : 1;
    return left.title.localeCompare(right.title) || (left.scope ?? "").localeCompare(right.scope ?? "");
  });
}
