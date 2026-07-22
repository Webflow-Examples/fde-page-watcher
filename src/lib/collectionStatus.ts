import type { WatchPage } from "./types";

/**
 * A committed history entry is the authoritative proof of a successful PSI
 * collection. `lastRunAt` cannot be used here because failures update it too.
 */
export function lastSuccessfulRunAt(page: WatchPage): string | null {
  for (let index = page.history.length - 1; index >= 0; index -= 1) {
    const iso = page.history[index].iso;
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
  if (!iso) return "No successful PSI run yet";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
