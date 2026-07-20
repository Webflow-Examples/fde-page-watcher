import { randomUUID } from "node:crypto";
import type { ChangeMarker, FollowUp, Night } from "./types";
import { parseMarkerDate } from "./ui";

const DAYS: { interval: FollowUp["interval"]; n: number }[] = [
  { interval: "2d", n: 2 },
  { interval: "7d", n: 7 },
  { interval: "30d", n: 30 },
];

/**
 * Schedule 2/7/30-day follow-up comparisons after a change marker (REQ-044).
 * Due dates are anchored to the MARKER's date, not the wall clock, so a
 * backdated or future-dated marker fires its comparisons at the right time
 * (audit High #4). The notifier fires them when due (REQ-045).
 */
export function scheduleFollowUps(pageId: string, marker: ChangeMarker): FollowUp[] {
  const anchor = parseMarkerDate(marker.date) ?? new Date();
  return DAYS.map(({ interval, n }) => ({
    id: randomUUID(),
    pageId,
    markerId: marker.id,
    markerText: marker.text,
    markerDate: marker.date,
    interval,
    dueISO: new Date(anchor.getTime() + n * 24 * 60 * 60 * 1000).toISOString(),
    sent: false,
    attempts: 0,
  }));
}

/** Place a marker on the latest collected night at or before its ISO date. */
export function resolveMarkerIndex(history: Night[], markerDate: string): number {
  const target = parseMarkerDate(markerDate);
  if (!target || history.length === 0) return Math.max(0, history.length - 1);
  let bestIndex = -1;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const night of history) {
    const date = parseMarkerDate(night.iso ?? night.date, target.getUTCFullYear());
    if (!date) continue;
    const time = date.getTime();
    if (time <= target.getTime() && (time > bestTime || (time === bestTime && night.i > bestIndex))) {
      bestTime = time;
      bestIndex = night.i;
    }
  }
  return bestIndex >= 0 ? bestIndex : history.reduce((min, night) => Math.min(min, night.i), history[0].i);
}
