import type { AppState, Night } from "../types";

export const HISTORY_STORAGE_VERSION = 1 as const;

export interface StoredHistoryRow {
  page_id: string;
  i: number;
  night_json: string;
}

/** Keep the compare-and-swap state row bounded; complete nights live in `history`. */
export function stateWithoutEmbeddedHistory(state: AppState): AppState {
  const persisted = structuredClone(state);
  persisted.historyStorageVersion = HISTORY_STORAGE_VERSION;
  for (const page of persisted.pages) page.history = [];
  return persisted;
}

/** Hydrate a table-backed state snapshot without accepting rows for another page. */
export function hydrateTableHistory(state: AppState, rows: readonly StoredHistoryRow[]): AppState {
  const byPage = new Map(state.pages.map((page) => [page.id, page]));
  for (const page of state.pages) page.history = [];
  for (const row of rows) {
    const page = byPage.get(row.page_id);
    if (!page) continue;
    const night = JSON.parse(row.night_json) as Night;
    if (!Number.isInteger(night.i) || night.i !== row.i) {
      throw new Error(`Invalid history row index for ${row.page_id}`);
    }
    page.history.push(night);
  }
  for (const page of state.pages) page.history.sort((left, right) => left.i - right.i);
  return state;
}
