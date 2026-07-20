import type { ChangeMarker, FollowUp } from "./types";
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
