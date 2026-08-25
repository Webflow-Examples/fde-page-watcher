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

export const ISSUE_ACTIONS = ["accept", "dismiss", "start", "mark_fixed", "reopen"] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

export const ISSUE_ACTION_LABEL: Record<IssueAction, string> = {
  accept: "Accept",
  dismiss: "Dismiss",
  start: "Start",
  mark_fixed: "Mark fixed",
  reopen: "Reopen",
};

export interface IssueTransition {
  readonly from: readonly WorkState[];
  readonly to: WorkState;
  readonly requiresReason: boolean;
}

export const ISSUE_TRANSITIONS: Record<IssueAction, IssueTransition> = {
  accept: { from: ["new", "reopened"], to: "todo", requiresReason: false },
  dismiss: { from: ["new", "reopened"], to: "dismissed", requiresReason: true },
  start: { from: ["todo"], to: "in_progress", requiresReason: false },
  mark_fixed: { from: ["in_progress"], to: "fixed", requiresReason: false },
  // From fixed: a checkpoint failed, so the change did not hold. From resolved:
  // it came back later. From dismissed: someone changed their mind.
  reopen: { from: ["fixed", "resolved", "dismissed"], to: "reopened", requiresReason: false },
};

/** Dismissing requires one of these reasons. */
export const DISMISS_REASONS = ["Not applicable", "Intentional", "Accepted risk", "Not now"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

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
