import type { AppState, ChangeMarker, Rec } from "./types";
import { resolveMarkerIndex } from "./followups";

const LEGACY_TASK_PREFIX = "Acted:";
const TASK_PREFIX = "Completed:";

export function taskMarkerText(title: string): string {
  return `${TASK_PREFIX} ${title}`;
}

export function isTaskMarker(marker: ChangeMarker): boolean {
  if (marker.source === "custom") return false;
  return marker.source === "task"
    || !!marker.recKey
    || marker.text.startsWith(`${LEGACY_TASK_PREFIX} `)
    || marker.text.startsWith(`${TASK_PREFIX} `);
}

export function taskMarkerMatches(marker: ChangeMarker, rec: Pick<Rec, "key" | "title">): boolean {
  if (marker.recKey) return marker.recKey === rec.key;
  if (marker.source === "custom") return false;
  return marker.text === `${LEGACY_TASK_PREFIX} ${rec.title}`
    || marker.text === taskMarkerText(rec.title);
}

/** Remove the marker and pending follow-ups that are conditional on an open task. */
export function removeTaskMarker(state: AppState, rec: Pick<Rec, "key" | "pageId" | "title">): void {
  const page = state.pages.find((item) => item.id === rec.pageId);
  if (!page) return;
  const removedIds = new Set(
    page.markers.filter((marker) => taskMarkerMatches(marker, rec)).map((marker) => marker.id),
  );
  if (removedIds.size === 0) return;
  page.markers = page.markers.filter((marker) => !removedIds.has(marker.id));
  state.followUps = (state.followUps ?? []).filter((followUp) => !removedIds.has(followUp.markerId));
}

/** Repair legacy task markers and enforce their completed-state/date invariant on read. */
export function reconcileTaskMarkers(state: AppState): void {
  for (const rec of state.recs) {
    const page = state.pages.find((item) => item.id === rec.pageId);
    if (!page) continue;
    const matches = page.markers.filter((marker) => taskMarkerMatches(marker, rec));
    const completed = rec.status === "task" && rec.taskStatus === "done" && !!rec.doneDate;
    if (!completed) {
      removeTaskMarker(state, rec);
      continue;
    }

    const marker = matches[0] ?? {
      id: `task:${rec.key}`,
      i: resolveMarkerIndex(page.history, rec.doneDate!),
      date: rec.doneDate!,
      text: taskMarkerText(rec.title),
      source: "task" as const,
      recKey: rec.key,
    };
    marker.date = rec.doneDate!;
    marker.text = taskMarkerText(rec.title);
    marker.source = "task";
    marker.recKey = rec.key;
    marker.i = resolveMarkerIndex(page.history, marker.date);

    const duplicateIds = new Set(matches.slice(1).map((item) => item.id));
    page.markers = [
      ...page.markers.filter((item) => !duplicateIds.has(item.id) && item.id !== marker.id),
      marker,
    ];
    state.followUps = (state.followUps ?? []).filter((followUp) => !duplicateIds.has(followUp.markerId));
  }
}
