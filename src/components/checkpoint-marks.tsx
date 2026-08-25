import type { CheckpointView, MarkShape } from "@/lib/checkpoint-evaluation";
import {
  WATCH_MARK_PILL_NONE,
  ariaCheckpoint,
  formatDate,
  watchMarkPill,
} from "@/lib/watch-copy";

/**
 * The three checkpoints of one case, drawn as a run of marks (13a).
 *
 * A mark is 16px. That is deliberate and it is the smallest it can be: the
 * outcome lives in a glyph inside the circle, and a check inside a 9px circle
 * is a smudge rather than a check. The four silhouettes are distinct shapes —
 * an empty ring, a ring with a dash, a filled disc with a check, a filled disc
 * with a cross — so a reader who cannot separate hues loses nothing. There is
 * no green and no red here to remove.
 *
 * One mark in the run may render as a countdown pill instead (15d). The
 * countdown is not a separate column; it is the next scheduled mark, stretched,
 * in its own chronological place. Which one that is was decided by the
 * evaluator — `isNext` — so this file never works it out and never sees more
 * than one.
 */

const MARK_PX = 16;
/** The pill is 2px taller than a mark. The strip is sized for the taller of
 *  the two so that a row containing one is exactly as tall as a row that is
 *  not — the countdown must not change the height of a collapsed row. */
const PILL_PX = 18;
const GAP_PX = 5;

/* ── The four silhouettes ───────────────────────────────────────────────── */

const RING = (
  <circle cx="8" cy="8" r="7" fill="none" stroke="var(--checkpoint-mark-border)" strokeWidth="1.5" />
);
const DISC = <circle cx="8" cy="8" r="8" fill="var(--checkpoint-mark-fill)" />;

const SHAPES: Record<MarkShape, React.ReactNode> = {
  ring: RING,
  dash: (
    <>
      {RING}
      <path d="M4.75 8h6.5" stroke="var(--checkpoint-mark-border)" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  check: (
    <>
      {DISC}
      <path
        d="M4.5 8.4l2.4 2.4 4.6-5"
        fill="none"
        stroke="var(--checkpoint-mark-glyph)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  cross: (
    <>
      {DISC}
      <path
        d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2"
        fill="none"
        stroke="var(--checkpoint-mark-glyph)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </>
  ),
};

/* ── One mark ───────────────────────────────────────────────────────────── */

function Mark({ view, locale }: { view: CheckpointView; locale?: string }) {
  // The exact date lives here and in the drawer, never in the row: a row that
  // spelled out three dates would be a table of dates with a title attached.
  const label = ariaCheckpoint(view.interval, view.result, view.due, locale);
  return (
    <svg
      width={MARK_PX}
      height={MARK_PX}
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      style={{ display: "block", flex: "0 0 auto" }}
    >
      <title>{label}</title>
      {SHAPES[view.shape]}
    </svg>
  );
}

/* ── The countdown, which is a mark ─────────────────────────────────────── */

function CountdownPill({
  view,
  now,
  locale,
}: {
  view: CheckpointView | null;
  now: Date;
  locale?: string;
}) {
  const empty = view === null;
  const text = empty ? WATCH_MARK_PILL_NONE : watchMarkPill(view.due, now);
  // "none left" is the one warning in the run: every reading is in and none of
  // them could be taken, which is the only row in Watch a person must answer.
  const label = empty
    ? "No check left to take"
    : `${ariaCheckpoint(view.interval, view.result, view.due, locale)} — ${text}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={empty ? WATCH_MARK_PILL_NONE : `${ariaCheckpoint(view.interval, view.result, view.due, locale)}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: PILL_PX,
        padding: "0 7px",
        borderRadius: PILL_PX / 2,
        // Same outline value as an unfilled ring, so it reads as a mark that
        // was stretched to hold a word rather than as a chip that wandered in.
        border: `1.5px solid ${empty ? "var(--status-warning-text)" : "var(--checkpoint-mark-border)"}`,
        background: empty ? "var(--status-warning-bg)" : "transparent",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        // Ink, not the border value: neutral-600 at 12px does not clear 4.5:1.
        color: empty ? "var(--status-warning-text)" : "var(--text-body)",
      }}
    >
      {text}
    </span>
  );
}

/* ── The run ────────────────────────────────────────────────────────────── */

export interface CheckpointMarksProps {
  run: CheckpointView[];
  /** When set, the next scheduled mark carries its countdown. */
  countdown?: boolean;
  now?: Date;
  locale?: string;
}

/**
 * The run of marks, with at most one of them stretched into a countdown.
 *
 * `countdown` off is the case detail's reading of the same run: there the track
 * is permanent and carries the dates, so a countdown beside it would say a
 * third time what two things already say.
 */
export function CheckpointMarks({ run, countdown = false, now, locale }: CheckpointMarksProps) {
  const at = now ?? new Date();
  const nothingLeft = countdown && !run.some((view) => view.isNext);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: GAP_PX,
        // Fixed to the pill's height whether or not a pill is present.
        height: PILL_PX,
        flex: "0 0 auto",
      }}
    >
      {run.map((view) =>
        countdown && view.isNext ? (
          <CountdownPill key={view.interval} view={view} now={at} locale={locale} />
        ) : (
          <Mark key={view.interval} view={view} locale={locale} />
        ),
      )}
      {nothingLeft ? <CountdownPill view={null} now={at} locale={locale} /> : null}
    </span>
  );
}

/** The fixed date, as the row's secondary line. Never removed from the row. */
export function FixedLine({ text }: { text: string }) {
  return <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{text}</span>;
}

export { MARK_PX, PILL_PX, GAP_PX };
export { formatDate };
