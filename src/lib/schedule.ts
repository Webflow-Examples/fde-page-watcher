// The nightly collection runs at a fixed absolute time each day. Defined in UTC
// so every viewer sees the same moment rendered in their own local timezone.
// Wire the Webflow Cloud scheduled job / cron to this hour (see /api/cron/nightly).

export const NIGHTLY_RUN_UTC_HOUR = 3; // 03:00 UTC

/** The next future occurrence of the nightly run, as an absolute Date. */
export function nextNightlyRun(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setUTCHours(NIGHTLY_RUN_UTC_HOUR, 0, 0, 0);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Format the next run in the viewer's local timezone, e.g.
 * "Tonight · 8:00 PM PDT" or "Tomorrow · 8:00 PM PDT". Client-only (depends on
 * the local timezone); callers should render it after mount to avoid a
 * hydration mismatch.
 */
export function formatNextRunLocal(now: Date = new Date()): string {
  const next = nextNightlyRun(now);
  const rel = next.toLocaleDateString() === now.toLocaleDateString() ? "Tonight" : "Tomorrow";
  const time = next.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(next).find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${rel} · ${time}${tz ? ` ${tz}` : ""}`;
}
