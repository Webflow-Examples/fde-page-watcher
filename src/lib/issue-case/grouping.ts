import type { Caller } from "../caller";
import type { Confidence, EvidenceSource } from "../vocabulary";
import type { Effort, EvidenceEntry, IssueCase, IssueState, Remediation, TransitionOptions } from "./core";
import { IssueCaseError } from "./core";
import { applyAction, byWorstMeasured, confidenceFrom, mergeImpact, widerEffort } from "./core";

/* ── Grouping by cause ──────────────────────────────────────────────────── */

/** The merge below is its own agent: no person chose to fold these two rows. */
const GROUPING_CALLER: Caller = { kind: "system", agent: "grouping" };

/**
 * Which state survives when findings that share a cause become one case.
 *
 * Urgency order, not progress order: an active finding must never be hidden
 * behind a sibling that somebody resolved or set aside, because that is how a
 * live problem disappears from the Decide queue.
 */
const MERGE_PRECEDENCE: Record<IssueState, number> = {
  reopened: 0,
  new: 1,
  in_progress: 2,
  todo: 3,
  fixed: 4,
  resolved: 5,
  dismissed: 6,
};

/**
 * A `Record` over the state union rather than an array, so a state added to the
 * registry is a compile error here instead of an `indexOf` of -1 — which, being
 * lower than every real rank, would have made the new state outrank all seven
 * and win every merge silently.
 */
function mostUrgent(left: IssueState, right: IssueState): IssueState {
  return MERGE_PRECEDENCE[left] <= MERGE_PRECEDENCE[right] ? left : right;
}

function scopeFor(scope: IssueCase["scope"], pageIds: readonly string[]): IssueCase["scope"] {
  if (scope === "origin") return "origin";
  return pageIds.length > 1 ? "pages" : "page";
}

/**
 * Merge two ledgers, keeping one entry per source.
 *
 * Where both sides hold a reading from the same source the later `observedAt`
 * wins outright. The two are never combined — a merged reading would be a
 * composite, and the older one was true when it was taken, not half-true now.
 */
function mergeEvidence(left: readonly EvidenceEntry[], right: readonly EvidenceEntry[]): EvidenceEntry[] {
  const bySource = new Map<EvidenceSource, EvidenceEntry>();
  for (const entry of [...left, ...right]) {
    const existing = bySource.get(entry.source);
    if (!existing || entry.observedAt > existing.observedAt) bySource.set(entry.source, entry);
  }
  return [...bySource.values()];
}

/**
 * One case per cause.
 *
 * Two findings with the same cause are the same problem seen on two pages, so
 * they become one case listing every affected page. The first finding in the
 * input supplies the identity and the wording — same cause, same remediation —
 * and the merge keeps the worst observed impact rather than a sum, because
 * adding milliseconds across pages that share an asset would invent a number no
 * run ever measured.
 *
 * "Worst observed" is taken in EACH unit that was measured: the largest time and
 * the largest byte saving, never a sum and never a conversion between them.
 * `mergeImpact` also decides what the merged origin is — the origin of the
 * reading the case will display — so a group holding one byte reading from real
 * visitors and one simulated time does not call the time "Real users".
 */
export function groupByCause(cases: readonly IssueCase[], options: { at?: string } = {}): IssueCase[] {
  const at = options.at ?? new Date().toISOString();
  const byCause = new Map<string, IssueCase>();

  for (const item of cases) {
    const existing = byCause.get(item.cause);
    if (!existing) {
      byCause.set(item.cause, { ...item, pageIds: [...item.pageIds] });
      continue;
    }
    const pageIds = [...new Set([...existing.pageIds, ...item.pageIds])];
    const state = mostUrgent(existing.state, item.state);
    const evidence = mergeEvidence(existing.evidence, item.evidence);
    const history = [...existing.history, ...item.history].sort((a, b) => a.at.localeCompare(b.at));
    if (state !== existing.state) {
      history.push({
        at,
        from: existing.state,
        to: state,
        by: GROUPING_CALLER,
        reason: `Grouped with a finding on ${item.pageIds.join(", ") || "another page"} sharing this cause.`,
      });
    }
    byCause.set(item.cause, {
      ...existing,
      state,
      pageIds,
      scope: scopeFor(existing.scope === "origin" || item.scope === "origin" ? "origin" : "page", pageIds),
      strategies: [...new Set([...existing.strategies, ...item.strategies])],
      detectedAt: [existing.detectedAt, item.detectedAt].filter(Boolean).sort()[0] ?? existing.detectedAt,
      confirmedRuns: Math.max(existing.confirmedRuns, item.confirmedRuns),
      ...mergeImpact(existing, item),
      effort: widerEffort(existing.effort, item.effort),
      evidence,
      confidence: confidenceFrom(evidence),
      history,
    });
  }

  return [...byCause.values()];
}

/* ── Grouping by remediation ────────────────────────────────────────────── */

/**
 * The remediation a set of cases shares, as a comparable key.
 *
 * The steps *are* the remediation, so identical ordered steps under the same
 * actionability are the same piece of work — done once, it covers every case
 * keyed to it. Actionability is part of the key because a platform-owned case
 * and a customer-fixable one are not the same job even when the words match.
 *
 * A case with no documented steps shares its remediation with nothing and keys
 * on its cause. Collapsing every step-less case into one bucket would put
 * unrelated problems behind a single row and claim one fix covered them all,
 * which is the failure grouping exists to prevent rather than to cause.
 *
 * That fallback names the CAUSE and never the case id, which is load-bearing
 * rather than tidy. A case is a group with no identity of its own: the merged
 * case takes the id of whichever member came first, and that id is a page's
 * `rec.key`, so it moves the moment membership does. F5 persists decisions
 * against this key, and a key that moves is a decision that quietly detaches
 * from the thing it was about — on the commonest path of all, since a record
 * with no documented remediation is the ordinary case rather than the edge.
 * The cause does not move. Grouping is unchanged by the swap: `groupByCause`
 * runs before every caller of this, so causes are already unique and each
 * fallback bucket still holds exactly one case, exactly as the id did.
 */
export function remediationKey(issue: IssueCase): string {
  const steps = issue.remediation.steps.map((step) => step.trim()).filter(Boolean);
  if (steps.length === 0) return `cause:${issue.cause}`;
  // JSON-encoded rather than joined on a separator: a step is free text, so any
  // separator a step could itself contain would let two different remediations
  // produce one key.
  return `steps:${issue.remediation.actionability}:${JSON.stringify(steps)}`;
}

/**
 * The same key with the actionability taken out.
 *
 * Two remediations whose steps match but whose actionability differs are one
 * remediation for the single purpose of noticing that a decision was stranded.
 * The steps are what a person read and agreed to; a reclassification did not
 * change them, it changed who the registry says owns the work. So the old entry
 * is recognisably about this remediation, and recognisably not about it any
 * more — which is exactly the pair of facts the stranded rule needs.
 *
 * Takes a key rather than a case, because a stranded entry has no case under
 * its key any more. A stored string is all that is left to compare.
 *
 * Lives here, beside the function whose output it parses, so the format has one
 * owner. Split across two modules it would be two statements of one encoding,
 * and the second would be wrong the first time the first one changed.
 */
export function remediationIdentity(key: string): string {
  const match = /^steps:[a-z_]+:([\s\S]*)$/.exec(key);
  return match ? `steps:${match[1]}` : key;
}

/**
 * Weakest wins: a group is no more certain than its least certain member.
 *
 * Keyed over the registry's union for the same reason as `MERGE_PRECEDENCE`: an
 * `indexOf` miss ranks -1, which is weaker than `unclear`, so a confidence
 * value the registry gained would have quietly become the weakest of all.
 */
const CONFIDENCE_PRECEDENCE: Record<Confidence, number> = { unclear: 0, probable: 1, confirmed: 2 };

function weakerConfidence(left: Confidence, right: Confidence): Confidence {
  return CONFIDENCE_PRECEDENCE[left] <= CONFIDENCE_PRECEDENCE[right] ? left : right;
}

/**
 * One remediation and every case it fixes.
 *
 * Deliberately not an `IssueCase`: a merged case would need one diagnosis, one
 * cause and one lifecycle for what may be several distinct problems that happen
 * to share a fix, and inventing those is how a row starts describing something
 * no run ever found. Members keep their own identity and stay individually
 * addressable; the group carries only what is genuinely shared.
 */
export interface RemediationGroup {
  /** Stable across renders for the same input. Not user-visible. */
  key: string;
  /** The remediation every member shares. */
  remediation: Remediation;
  /** Cause-grouped members, largest impact first. Never empty. */
  cases: IssueCase[];
  /** The member whose wording the group shows — the largest impact of them. */
  primary: IssueCase;
  /** Every page any member covers, first seen first. */
  pageIds: string[];
  /** The most urgent member state: a live problem never hides behind a settled one. */
  state: IssueState;
  /**
   * The worst reading any member produced — the same statistic as the number on
   * the row beneath it, never a sum (registry rule 19).
   *
   * A total would be a figure no run ever produced, and one the reader cannot
   * reconcile against the rows it sits above: three members reading 600, 500 and
   * 400 ms under a header reading 1,500 ms leaves them looking for a fourth. The
   * group renders it as "up to", because that is what a worst-of is.
   *
   * 0 when no member was measured at all, which the row renders as words rather
   * than as a number (rule 18).
   */
  impactMs: number;
  /**
   * The worst byte saving any member produced, merged the same way as the time
   * and never summed with it: bytes and milliseconds measure different things.
   * Absent when no member measured bytes.
   */
  impactBytes?: number;
  /** The origin of the reading the header displays. See `mergeImpact`. */
  impactOrigin?: IssueCase["impactOrigin"];
  /**
   * The one shared effort, never a sum — the remediation is carried out once.
   * Where members disagree on the band, the wider one stands.
   */
  effort: Effort;
  /** The weakest member confidence. */
  confidence: Confidence;
  /** The earliest detection among the members. */
  detectedAt: string;
}

/**
 * One group per remediation.
 *
 * Cause grouping already collapses the same problem seen on several pages. This
 * goes one step further, to the unit a person actually decides on: two cases
 * with different causes that the same steps fix are one piece of work, and a
 * list that shows them apart asks for the same decision twice.
 *
 * `groupByCause` runs first rather than being reimplemented — a second merge
 * rule for pages, evidence and state is exactly the drift this module exists to
 * prevent. Everything below only buckets what that returns.
 *
 * Nothing is added up on the way. `groupByCause` refuses to sum across pages
 * sharing an asset because it would invent a number no run measured, and a
 * group total that cannot be reconciled against its own member rows is the same
 * defect one level up (rule 19).
 */
export function groupByRemediation(
  cases: readonly IssueCase[],
  options: { at?: string } = {},
): RemediationGroup[] {
  const byRemediation = new Map<string, IssueCase[]>();
  for (const item of groupByCause(cases, options)) {
    const key = remediationKey(item);
    const members = byRemediation.get(key);
    if (members) members.push(item);
    else byRemediation.set(key, [item]);
  }

  return [...byRemediation].map(([key, members]) => {
    // Worst measured first, so the wording comes from the largest member and an
    // unmeasured one sorts last within the group rather than ranking as a zero
    // (rule 18). The id breaks the tie, so two runs over the same data read
    // identically. The comparator reads bytes too, so a byte-only member is not
    // treated as unmeasured.
    const ordered = [...members].sort((a, b) => byWorstMeasured(a, b) || a.id.localeCompare(b.id));
    const primary = ordered[0];
    const impact = ordered
      .map((item) => ({ impactMs: item.impactMs, impactBytes: item.impactBytes, impactOrigin: item.impactOrigin }))
      .reduce(
        (merged: { impactMs: number; impactBytes?: number; impactOrigin?: IssueCase["impactOrigin"] }, item) =>
          mergeImpact(merged, item),
        { impactMs: 0 } as { impactMs: number; impactBytes?: number; impactOrigin?: IssueCase["impactOrigin"] },
      );
    return {
      key,
      remediation: primary.remediation,
      cases: ordered,
      primary,
      pageIds: [...new Set(ordered.flatMap((item) => item.pageIds))],
      state: ordered.map((item) => item.state).reduce(mostUrgent),
      ...impact,
      effort: ordered.map((item) => item.effort).reduce(widerEffort),
      confidence: ordered.map((item) => item.confidence).reduce(weakerConfidence),
      detectedAt: ordered.map((item) => item.detectedAt).filter(Boolean).sort()[0] ?? primary.detectedAt,
    };
  });
}

/**
 * A check found the problem back on some of the pages this case covers.
 *
 * The case reopens scoped to those pages only — the ones that came back are the
 * ones that need a new decision, and carrying the rest along would overstate
 * the problem. The move itself goes through the registry's table, so a case the
 * registry gives no reopen path from throws rather than being forced.
 */
export function reopenForPages(
  issue: IssueCase,
  pageIds: readonly string[],
  options: TransitionOptions,
): IssueCase {
  if (pageIds.length === 0) {
    throw new IssueCaseError(`reopenForPages: ${issue.id} needs at least one page that came back.`);
  }
  const returned = pageIds.filter((pageId) => issue.pageIds.includes(pageId));
  if (returned.length === 0) {
    throw new IssueCaseError(
      `reopenForPages: ${issue.id} does not cover ${pageIds.join(", ")}.`,
    );
  }
  const reopened = applyAction(issue, "reopen", options);
  return { ...reopened, pageIds: returned, scope: scopeFor(issue.scope, returned) };
}
