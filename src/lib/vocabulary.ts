/**
 * Page Watch status vocabulary — the one place the app's user-facing status
 * words live.
 *
 * Mirrors `vocabulary.json` at the repo root, which is the decided source of
 * truth (chunk F1). Every value list, label, and tone name here is checked
 * against that file by `src/lib/__tests__/vocabulary.test.ts`, so the two
 * cannot drift: edit `vocabulary.json` first, then bring this file into line
 * and the test will confirm it.
 *
 * Do not hand-write a state, queue, or action list anywhere else in the app.
 * Import from here instead.
 *
 * Tones are NAMES, never colour values. `src/components/status-chip.tsx` turns
 * a tone name into `var(--status-<tone>-*)`; chunk F3 defines those tokens.
 */

/* ── Tones ──────────────────────────────────────────────────────────────── */

/** Seven states, five tones. */
export const TONES = ["information", "neutral", "warning", "success", "danger"] as const;
export type Tone = (typeof TONES)[number];

/* ── Work state — where one issue case is in its lifecycle ──────────────── */

export const WORK_STATES = ["new", "todo", "in_progress", "fixed", "resolved", "reopened", "dismissed"] as const;
export type WorkState = (typeof WORK_STATES)[number];

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  new: "New",
  todo: "To do",
  in_progress: "In progress",
  fixed: "Fixed",
  resolved: "Resolved",
  reopened: "Reopened",
  dismissed: "Dismissed",
};

export const WORK_STATE_TONE: Record<WorkState, Tone> = {
  new: "information",
  todo: "neutral",
  in_progress: "neutral",
  fixed: "warning",
  resolved: "success",
  reopened: "danger",
  dismissed: "neutral",
};

/** What each state means, in the plainest word that is true. */
export const WORK_STATE_MEANS: Record<WorkState, string> = {
  new: "Detected and corroborated. Nobody has looked yet.",
  todo: "Somebody said yes. Nobody has started.",
  in_progress: "Someone is mid-task.",
  fixed: "The change shipped. Evidence has not agreed yet.",
  resolved: "The evidence agreed and held.",
  reopened: "A check found the problem back. Needs a new decision.",
  dismissed: "Deliberately excluded. Off-ramp from Decide only, and it requires a reason.",
};

/* ── Queue — a filter over work state, named with a verb ────────────────── */

export const QUEUES = ["decide", "fix", "watch", "show_all"] as const;
export type Queue = (typeof QUEUES)[number];

export const QUEUE_LABEL: Record<Queue, string> = {
  decide: "Decide",
  fix: "Fix",
  watch: "Watch",
  show_all: "Show all",
};

/**
 * Which states each queue holds. `show_all` is the unfiltered view, not a
 * queue, so it holds every state and is never counted.
 */
export const QUEUE_HOLDS: Record<Queue, readonly WorkState[]> = {
  decide: ["new", "reopened"],
  fix: ["todo", "in_progress"],
  watch: ["fixed"],
  show_all: WORK_STATES,
};

/** `show_all` carries no count badge. */
export const COUNTED_QUEUES: readonly Queue[] = ["decide", "fix", "watch"];

/** The queue a state appears in when queues are treated as a partition. */
export const WORK_STATE_QUEUE: Record<WorkState, Queue> = {
  new: "decide",
  todo: "fix",
  in_progress: "fix",
  fixed: "watch",
  resolved: "show_all",
  reopened: "decide",
  dismissed: "show_all",
};

/* ── Action — the verbs that move an issue between states ───────────────── */

export const ISSUE_ACTIONS = ["accept", "dismiss", "start", "mark_fixed", "resolve", "reopen"] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

export const ISSUE_ACTION_LABEL: Record<IssueAction, string> = {
  accept: "Accept",
  dismiss: "Dismiss",
  start: "Start",
  mark_fixed: "Mark fixed",
  resolve: "Resolve",
  reopen: "Reopen",
};

/** Who fires a transition. Not every move is a button. */
export type TransitionActor = "person" | "system";

/** What a transition needs before it may fire. */
export type TransitionRequirement = "reason" | "checkpoint_agreement";

export interface IssueTransition {
  readonly from: readonly WorkState[];
  readonly to: WorkState;
  /** `reopen` is both: a person from dismissed, the system from a failed check. */
  readonly actor: readonly TransitionActor[];
  readonly requires: TransitionRequirement | null;
  /** True only when `requires` is "reason". Convenience for the dismiss guard. */
  readonly requiresReason: boolean;
}

export const ISSUE_TRANSITIONS: Record<IssueAction, IssueTransition> = {
  accept: { from: ["new", "reopened"], to: "todo", actor: ["person"], requires: null, requiresReason: false },
  dismiss: { from: ["new", "reopened"], to: "dismissed", actor: ["person"], requires: "reason", requiresReason: true },
  start: { from: ["todo"], to: "in_progress", actor: ["person"], requires: null, requiresReason: false },
  // Schedules the three checkpoints. The checkpoint concept says what reads them.
  mark_fixed: { from: ["in_progress"], to: "fixed", actor: ["person"], requires: null, requiresReason: false },
  // Nobody presses this — no button carries the label. The 30-day checkpoint
  // fires it once every checkpoint that produced a reading agreed. Before v5
  // Resolved had no legal entry at all, which rule 14 names as a bug.
  resolve: { from: ["fixed"], to: "resolved", actor: ["system"], requires: "checkpoint_agreement", requiresReason: false },
  // From fixed the system fires it — a checkpoint disagreed, so the change did
  // not hold. From resolved it came back later. From dismissed a person changed
  // their mind. All three land in Decide.
  reopen: { from: ["fixed", "resolved", "dismissed"], to: "reopened", actor: ["person", "system"], requires: null, requiresReason: false },
};

/** Dismissing requires one of these reasons. */
export const DISMISS_REASONS = ["Not applicable", "Intentional", "Accepted risk", "Not now"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

/* ── Checkpoint — one scheduled re-measurement of a fixed issue ─────────── */

/**
 * Three per issue, 2/7/30 days after Mark fixed, drawn as the three dots on the
 * case. Not a lifecycle state: the issue stays Fixed while they run.
 *
 * These are deliberately not `passed`/`failed`. Those words belong to
 * `agent_result`, on a check. A checkpoint is not a check — it asks whether an
 * earlier conclusion still holds, so it agrees or disagrees with it.
 */
export const CHECKPOINT_RESULTS = ["scheduled", "agreed", "disagreed", "unavailable"] as const;
export type CheckpointResult = (typeof CHECKPOINT_RESULTS)[number];

export const CHECKPOINT_RESULT_LABEL: Record<CheckpointResult, string> = {
  scheduled: "Scheduled",
  agreed: "Agreed",
  disagreed: "Disagreed",
  unavailable: "Unavailable",
};

export const CHECKPOINT_RESULT_MEANS: Record<CheckpointResult, string> = {
  scheduled: "Due in the future. Nothing has been measured yet.",
  agreed: "The re-measurement no longer finds the problem.",
  disagreed: "The re-measurement still finds the problem.",
  unavailable:
    "No reading could be taken — the page did not answer, or the collector had no data for the window. Neither agreement nor disagreement. Same condition as agent_result.unavailable on a different object, which rule 4 allows.",
};

/**
 * The decided evaluation rules, verbatim from the registry. Carried here so the
 * evaluator can be read against them without opening the JSON; the parity test
 * asserts they match.
 */
export const CHECKPOINT_EVALUATION: readonly string[] = [
  "A checkpoint that disagrees fires reopen at once. Remaining checkpoints are cancelled: the case is back in Decide, and the next mark_fixed schedules a fresh set of three.",
  "Unavailable neither advances nor reopens. Retry once at +24h, then record Unavailable and carry on to the next checkpoint.",
  "The 30-day checkpoint fires resolve when every checkpoint that produced a reading agreed. Unavailable readings are skipped, not counted against.",
  "Three unavailable readings do not resolve. The case stays Fixed and says no check could be taken; the user may Reopen it or leave it in Watch.",
  "The 2 and 7-day checkpoints never resolve on their own. Rule 5 says Resolved means the evidence agreed and held, and holding takes the full 30 days.",
];

/* ── Evidence source — who took a reading in the ledger ─────────────────── */

/**
 * One entry per system, never a blend. The ledger exists so that two systems
 * disagreeing is visible rather than averaged away, which is why Ora has its
 * own slot: sharing one with Page Watch's checks made `confidenceFrom` count
 * them as a single voice, so that disagreement could never surface.
 */
export const EVIDENCE_SOURCES = [
  "lighthouse",
  "crux",
  "native-elements",
  "agent-readiness",
  "ora",
  "kitesurf",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const EVIDENCE_SOURCE_LABEL: Record<EvidenceSource, string> = {
  lighthouse: "Lighthouse",
  crux: "Chrome UX Report",
  "native-elements": "Native elements",
  "agent-readiness": "Agent readiness checks",
  ora: "Ora",
  // Registry v10: the codename was the only name a reader ever saw for this
  // system, and a codename explains nothing. The KEY is unchanged — a data key
  // is not copy — so no stored reading has to be migrated.
  kitesurf: "Rendered page",
};

/* ── Actionability — what the customer can do about a case ──────────────── */

/** Decides whether Accept is offered at all. */
export const ACTIONABILITIES = ["direct", "workaround", "platform", "none"] as const;
export type Actionability = (typeof ACTIONABILITIES)[number];

export const ACTIONABILITY_LABEL: Record<Actionability, string> = {
  direct: "Direct fix",
  workaround: "Workaround",
  platform: "Platform",
  none: "No action available",
};

export const ACTIONABILITY_MEANS: Record<Actionability, string> = {
  direct: "There is a documented change the customer can make.",
  workaround: "No direct fix, but there is a documented way around it.",
  platform: "Webflow owns this one. Nothing for the customer to do; the case is shown so the reading is not hidden.",
  none: "No documented remediation exists yet. Accept is not offered.",
};

/**
 * Rule 17: a `none` case must say in one sentence why there is no action, or it
 * reads as a broken card rather than an honest one.
 */
export const ACTIONABILITY_REQUIRES_REASON: Record<Actionability, boolean> = {
  direct: false,
  workaround: false,
  platform: false,
  none: true,
};

/** Accept is offered on everything except a case with no documented remediation. */
export function acceptIsOffered(actionability: Actionability): boolean {
  return actionability !== "none";
}

/* ── Trend — direction of the score line, never a health statement ──────── */

export const TRENDS = ["improving", "no_change", "regressing"] as const;
export type Trend = (typeof TRENDS)[number];

export const TREND_LABEL: Record<Trend, string> = {
  improving: "Improving",
  no_change: "No change",
  regressing: "Regressing",
};

/* ── Health — how the page is doing now, independent of direction ───────── */

export const HEALTHS = ["good", "needs_work", "poor"] as const;
export type Health = (typeof HEALTHS)[number];

export const HEALTH_LABEL: Record<Health, string> = {
  good: "Good",
  needs_work: "Needs work",
  poor: "Poor",
};

/* ── Confidence — how much the evidence supports the diagnosis ──────────── */

export const CONFIDENCES = ["confirmed", "probable", "unclear"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  confirmed: "Confirmed",
  probable: "Probable",
  unclear: "Unclear",
};

/* ── Agent result — outcome of one agent-readiness check ────────────────── */

export const AGENT_RESULTS = ["passed", "partial", "failed", "not_applicable", "unavailable", "ignored"] as const;
export type AgentResult = (typeof AGENT_RESULTS)[number];

export const AGENT_RESULT_LABEL: Record<AgentResult, string> = {
  passed: "Passed",
  partial: "Partial",
  failed: "Failed",
  not_applicable: "Not applicable",
  unavailable: "Unavailable",
  ignored: "Ignored",
};

/* ── Agent verdict — one product conclusion for agent access ────────────── */

export const AGENT_VERDICTS = ["ready", "needs_work", "blocked", "unknown"] as const;
export type AgentVerdict = (typeof AGENT_VERDICTS)[number];

export const AGENT_VERDICT_LABEL: Record<AgentVerdict, string> = {
  ready: "Ready",
  needs_work: "Needs work",
  blocked: "Blocked",
  unknown: "Unknown",
};

/* ── Destination — primary navigation, four of them ─────────────────────── */

export const DESTINATIONS = ["issues", "pages", "watchlist", "settings"] as const;
export type Destination = (typeof DESTINATIONS)[number];

export const DESTINATION_LABEL: Record<Destination, string> = {
  issues: "Issues",
  pages: "Pages",
  watchlist: "Watchlist",
  settings: "Settings",
};

export const DESTINATION_PATH: Record<Destination, string> = {
  issues: "/issues",
  pages: "/pages",
  watchlist: "/watchlist",
  settings: "/settings",
};

/* ── Applicability — whether something counts toward this site's results ── */

/**
 * Not a lifecycle. It says whether a check, a check group, or a native-element
 * finding applies to this site, never how far along it is. An excluded check
 * still shows its last reading with its reason — excluding is not deleting.
 */
export const APPLICABILITIES = ["included", "excluded"] as const;
export type Applicability = (typeof APPLICABILITIES)[number];

export const APPLICABILITY_LABEL: Record<Applicability, string> = {
  included: "Included",
  excluded: "Excluded",
};

export const APPLICABILITY_MEANS: Record<Applicability, string> = {
  included: "Counts toward results. The default.",
  excluded: "Deliberately not counted, because it does not apply to this site.",
};

export const APPLICABILITY_ACTIONS = ["exclude", "include"] as const;
export type ApplicabilityAction = (typeof APPLICABILITY_ACTIONS)[number];

export const APPLICABILITY_ACTION_LABEL: Record<ApplicabilityAction, string> = {
  exclude: "Exclude",
  include: "Include",
};

export interface ApplicabilityTransition {
  readonly from: readonly Applicability[];
  readonly to: Applicability;
  readonly requiresReason: boolean;
}

export const APPLICABILITY_TRANSITIONS: Record<ApplicabilityAction, ApplicabilityTransition> = {
  exclude: { from: ["included"], to: "excluded", requiresReason: true },
  include: { from: ["excluded"], to: "included", requiresReason: false },
};

/** Excluding requires one of these reasons. */
export const EXCLUSION_REASONS = ["Not applicable to this site", "Intentional", "Accepted risk"] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/**
 * The reason an exclusion carries when it was made by a control that never
 * asked for one.
 *
 * Not a reason invented on the reader's behalf. `APPLICABILITY_MEANS.excluded`
 * is "Deliberately not counted, because it does not apply to this site", and
 * every retired on/off exclusion control offered exactly that one meaning,
 * unlabelled, with nowhere to record anything narrower. Migrating such a record
 * to the reason that restates its own definition keeps the exclusion the reader
 * asked for; dropping it instead would quietly put the thing back in the count.
 *
 * Two mechanisms need this and so it is stated once here rather than beside
 * either of them: the retired native-element `suppressed` disposition, and the
 * agent-check exclusion defaults, whose conversion to a chosen reason is C2's.
 */
export const UNLABELLED_EXCLUSION_REASON: ExclusionReason = "Not applicable to this site";

/* ── Helpers ────────────────────────────────────────────────────────────── */

export function isQueue(value: unknown): value is Queue {
  return typeof value === "string" && (QUEUES as readonly string[]).includes(value);
}

export function isWorkState(value: unknown): value is WorkState {
  return typeof value === "string" && (WORK_STATES as readonly string[]).includes(value);
}

/** Read a `?queue=` value. Anything unrecognised falls back to Decide. */
export function parseQueue(value: string | null | undefined): Queue {
  return isQueue(value) ? value : "decide";
}

export function statesInQueue(queue: Queue): readonly WorkState[] {
  return QUEUE_HOLDS[queue];
}

export function queueHoldsState(queue: Queue, state: WorkState): boolean {
  return QUEUE_HOLDS[queue].includes(state);
}

/** Which actions are legal from a given state. */
export function actionsFromState(state: WorkState): readonly IssueAction[] {
  return ISSUE_ACTIONS.filter((action) => ISSUE_TRANSITIONS[action].from.includes(state));
}

/**
 * The one action available on something with this applicability — what the
 * toggle should say. Included things can be excluded; excluded things can be
 * put back.
 */
export function applicabilityActionFor(current: Applicability): ApplicabilityAction {
  return current === "included" ? "exclude" : "include";
}

/** The label for that toggle, straight from the registry. */
export function applicabilityActionLabel(current: Applicability): string {
  return APPLICABILITY_ACTION_LABEL[applicabilityActionFor(current)];
}
