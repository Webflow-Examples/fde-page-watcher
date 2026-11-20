import type { AppState, Night } from "../types";

/**
 * The write protocol between the app and the FDE data plane.
 *
 * A state can be tens of megabytes once embedded history is counted, while the
 * collector keeps that history in its own table and the state row without it.
 * Sending the whole snapshot on every mutation therefore both wastes the wire
 * and crosses the collector's request limit. A write that says what happened to
 * history carries the small state and only the nights that moved.
 */

/** One night to write, and the page it belongs to. */
export interface HistoryUpsert {
  pageId: string;
  night: Night;
}

/** One stored night to remove, named the way the table stores it. */
export interface HistoryDelete {
  pageId: string;
  i: number;
}

/**
 * What a write says about table-backed history.
 *
 * `"unchanged"` keeps every stored night. A delta names only the nights that
 * moved, so an append or a trim still applies exactly. An absent value is the
 * legacy full snapshot, where the embedded history is authoritative.
 */
export type HistoryWrite = "unchanged" | { upserts: HistoryUpsert[]; deletes: HistoryDelete[] };

export interface StateWriteRequest {
  state: AppState;
  expectedVersion: number | null;
  history?: HistoryWrite;
}

export const HISTORY_WRITE_CAPABILITY_HEADER = "x-fde-history-write";
export const HISTORY_WRITE_CAPABILITY = "delta";

/**
 * Read the history member of a write.
 *
 * `undefined` means the writer sent the legacy full snapshot; `null` means the
 * member was present but is not something this collector can apply. The two
 * are different answers: the first is safe to accept, the second is a rejected
 * request rather than an empty history delta.
 */
export function historyWriteFrom(value: unknown): HistoryWrite | null | undefined {
  if (value === undefined) return undefined;
  if (value === "unchanged") return value;
  if (!value || typeof value !== "object") return null;

  const candidate = value as { upserts?: unknown; deletes?: unknown };
  if (!Array.isArray(candidate.upserts) || !Array.isArray(candidate.deletes)) return null;

  const upserts: HistoryUpsert[] = [];
  for (const entry of candidate.upserts) {
    if (!entry || typeof entry !== "object") return null;
    const { pageId, night } = entry as { pageId?: unknown; night?: unknown };
    if (typeof pageId !== "string" || !pageId) return null;
    if (!night || typeof night !== "object" || !Number.isInteger((night as Night).i)) return null;
    upserts.push({ pageId, night: night as Night });
  }

  const deletes: HistoryDelete[] = [];
  for (const entry of candidate.deletes) {
    if (!entry || typeof entry !== "object") return null;
    const { pageId, i } = entry as { pageId?: unknown; i?: unknown };
    if (typeof pageId !== "string" || !pageId || !Number.isInteger(i)) return null;
    deletes.push({ pageId, i: i as number });
  }

  return { upserts, deletes };
}
