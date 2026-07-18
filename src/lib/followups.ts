import type { FollowUp } from "./types";

const DAYS: { interval: FollowUp["interval"]; n: number }[] = [
  { interval: "2d", n: 2 },
  { interval: "7d", n: 7 },
  { interval: "30d", n: 30 },
];

/**
 * Schedule 2/7/30-day follow-up comparisons after a change marker (REQ-044).
 * Due dates are computed from now; the notifier fires them when due (REQ-045).
 */
export function scheduleFollowUps(pageId: string, markerText: string, markerDate: string): FollowUp[] {
  const now = Date.now();
  return DAYS.map(({ interval, n }) => ({
    pageId,
    markerText,
    markerDate,
    interval,
    dueISO: new Date(now + n * 24 * 60 * 60 * 1000).toISOString(),
    sent: false,
  }));
}
