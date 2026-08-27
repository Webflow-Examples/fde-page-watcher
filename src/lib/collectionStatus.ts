import type { WatchPage } from "./types";
import { nightHasStrategy } from "./scoring";
import { naturalDate } from "./ui";

/**
 * A committed history entry is the authoritative proof of a successful PSI
 * collection. `lastRunAt` cannot be used here because failures update it too.
 */
export function lastSuccessfulRunAt(page: WatchPage): string | null {
  for (let index = page.history.length - 1; index >= 0; index -= 1) {
    const night = page.history[index];
    if (!nightHasStrategy(night, "mobile") && !nightHasStrategy(night, "desktop")) continue;
    const captured = Object.values(night.strategyCapturedAt ?? {})
      .filter((value): value is string => typeof value === "string")
      .sort()
      .at(-1);
    const iso = captured ?? night.iso;
    if (iso && Number.isFinite(Date.parse(iso))) return iso;
  }
  return null;
}

export function latestSuccessfulRunAt(pages: WatchPage[]): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const page of pages) {
    const iso = lastSuccessfulRunAt(page);
    if (!iso) continue;
    const time = Date.parse(iso);
    if (time > latestTime) {
      latest = iso;
      latestTime = time;
    }
  }
  return latest;
}

export function formatSuccessfulRunAt(iso: string | null): string {
  if (!iso) return "No successful measurement yet";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function failedRunLabel(page: WatchPage, now: Date = new Date()): string {
  const capturedAt = lastSuccessfulRunAt(page);
  return capturedAt
    ? `Failed run; last captured ${naturalDate(capturedAt, now)}`
    : "Failed run; no successful capture yet";
}

export function failedRunDetailMessage(error?: string): string {
  if (error && /exceeded the 30 minute stale limit/i.test(error)) {
    return "Run exceeded the 30-minute stale limit. Run a scan now manually or wait for the next nightly run.";
  }
  return error ?? "The collector stopped before a result could be committed. Start a new run to retry.";
}
