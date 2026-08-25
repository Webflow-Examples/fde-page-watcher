import { CHECKPOINT_LABEL, watchTrackAgreed, watchTrackDue, watchTrackProgress, watchTrackSegment } from "@/lib/watch-copy";
import type { CheckpointView } from "@/lib/checkpoint-evaluation";

/**
 * The three checkpoints as a track (14c).
 *
 * One component, two contexts: it appears beneath the marks when a Watch row is
 * expanded, and permanently on the case detail. Nothing in it knows which of
 * the two it is in, so it can be moved into a popover later without being
 * rewritten — if the drawer turns out to read badly in the assembled page, the
 * move is a change of parent.
 *
 * The three segments are EQUAL WIDTH, always. Laying them out in proportion to
 * 2, 7 and 30 days is the obvious idea and it is wrong: it crushes the first
 * two checks into the opening fifth of the track, which is exactly where the
 * early evidence is and exactly what the reader came to look at. The days are
 * written into each segment, so the span is stated rather than drawn to scale.
 */

export interface CheckpointTrackProps {
  run: CheckpointView[];
  /** When the fix shipped, for "Day n of 30". */
  fixedAt?: string;
  /** The span the progress line counts out of — the resolving interval's days. */
  span: number;
  now?: Date;
  locale?: string;
}

/**
 * Which date the segment's last line shows.
 *
 * A reading that agreed says when it agreed. Anything else has no outcome date
 * to give, so the segment says what it is still waiting for instead. Both facts
 * arrive on the view: branching on the result here would make this file a
 * second reader of it.
 */
function segmentDetail(view: CheckpointView, locale?: string): string {
  return view.agreed ? watchTrackAgreed(view.due, locale) : watchTrackDue(view.due, locale);
}

const LINE: React.CSSProperties = {
  fontSize: 12,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export function CheckpointTrack({ run, fixedAt, span, now, locale }: CheckpointTrackProps) {
  const at = now ?? new Date();
  return (
    <div>
      <div style={{ display: "flex", gap: 4 }}>
        {run.map((view) => (
          <div
            key={view.interval}
            // Equal segments: one basis, no growth from content. A long date in
            // one segment must not widen it at its neighbours' expense.
            style={{ flex: "1 1 0", minWidth: 0 }}
          >
            <div
              style={{
                height: 4,
                borderRadius: 2,
                // Filled once a reading came in, whatever it said. An
                // unavailable check was reached; drawing it as untouched would
                // lose that.
                background: view.read ? "var(--checkpoint-mark-fill)" : "var(--surface-raised)",
              }}
            />
            <div style={{ ...LINE, marginTop: 7, fontWeight: 600, color: "var(--text-body)" }}>
              {watchTrackSegment(view.interval)}
            </div>
            <div style={{ ...LINE, marginTop: 2, color: "var(--text-muted)" }}>
              {CHECKPOINT_LABEL[view.result]}
            </div>
            <div style={{ ...LINE, color: "var(--text-muted)" }}>{segmentDetail(view, locale)}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
        {watchTrackProgress(fixedAt, at, span)}
      </div>
    </div>
  );
}
