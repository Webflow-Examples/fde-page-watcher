import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppState, ChangeMarker, Night, WatchPage } from "../types";
import { buildSeedState } from "../seed";
import { classifyStatus, mediansOf } from "../scoring";
import { resolveMarkerIndex } from "../followups";

/**
 * Tenant-scoped data-access layer (REQ-001/002/031) backed by the local
 * filesystem, mirroring the three Webflow Cloud storage tiers under
 * `.data/<tenant>/`:
 *   - state.json            -> key-value read model: latest snapshots per
 *                              strategy, baselines, watchlist config, and the
 *                              recommendation lifecycle (REQ-005)
 *   - history/<id>.jsonl    -> append-only sequential daily history (REQ-004)
 *   - markers/<id>.jsonl    -> append-only sequential change markers (REQ-040)
 *   - reports/<id>/<key>    -> object storage for raw PSI / agent payloads (REQ-006)
 *
 * A Webflow Cloud adapter can implement the same DataStore interface later
 * with no call-site changes.
 */
export interface DataStore {
  readonly tenant: string;
  getState(): Promise<AppState>;
  /**
   * Atomically re-read, mutate, and commit the tenant state. Filesystem
   * adapters serialize this callback; durable adapters can map it to a
   * transaction or a conditional/versioned write.
   */
  updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState>;
  /** Nightly write fan-out: sequential history append + snapshot update + raw report (REQ-016). */
  appendNight(
    pageId: string,
    runId: string,
    night: Omit<Night, "i" | "runId" | "rawReportKey">,
    rawReport?: unknown,
  ): Promise<{ state: AppState; night: Night | null; inserted: boolean }>;
  addMarker(
    pageId: string,
    marker: Omit<ChangeMarker, "i">,
    mutate?: (state: AppState, marker: ChangeMarker) => void,
  ): Promise<AppState>;
  putReport(pageId: string, key: string, payload: unknown): Promise<void>;
  getReport(pageId: string, key: string): Promise<unknown | null>;
}

interface Envelope {
  tenant: string;
  updatedAt: string;
  state: AppState;
}

/**
 * Per-process in-memory tier, keyed by tenant. This is what keeps the app
 * working on hosts where the local disk isn't a usable persistence layer
 * (serverless/edge deployments — this app's target, Webflow Cloud, included —
 * may not allow writes at all, or only to an ephemeral temp dir). Disk is
 * still the source of truth wherever it is usable; memory is the fallback so
 * a Server Component render never crashes the whole app when disk I/O fails.
 */
const memoryState = new Map<string, AppState>();
const stateQueues = new Map<string, Promise<void>>();

function copyState(state: AppState): AppState {
  return structuredClone(state);
}

function normalizeState(state: AppState): AppState {
  for (const page of state.pages) {
    // Older pending records carried a zero-filled placeholder baseline. The
    // timestamp is the authoritative proof that baseline capture occurred.
    if (!page.baselineCapturedAt) delete page.baseline;
  }
  state.followUps = (state.followUps ?? []).map((followUp) => ({
    ...followUp,
    id: followUp.id ?? `legacy:${followUp.pageId}:${followUp.markerId}:${followUp.interval}:${followUp.dueISO}`,
  }));
  return state;
}

// Hosts vary in how they signal "the filesystem isn't usable here": a plain
// Node server throws standard errno codes (ENOENT/EROFS/EACCES/...), but
// serverless/edge runtimes (this app's target, Webflow Cloud, included) may
// run `node:fs` through a compatibility shim that throws something else
// entirely — a different code, no code at all, or a generic Error. Rather
// than maintain an allow-list that a new host can slip past and crash render
// again, every disk operation below is treated as best-effort: any failure
// falls back to the in-memory tier instead of propagating.

let warnedReadOnly = false;
function warnReadOnly(err: unknown): void {
  if (warnedReadOnly) return;
  warnedReadOnly = true;
  console.warn(
    "[DataStore] filesystem read/write failed; falling back to in-memory state " +
      "for this process. State will not persist across restarts or instances. " +
      "Configure a durable DataStore adapter for production.",
    (err as Error)?.message ?? err,
  );
}

class FsDataStore implements DataStore {
  readonly tenant: string;
  private root: string;

  constructor(tenant: string, rootDir = process.cwd()) {
    if (!tenant || !tenant.trim()) {
      // REQ-031: reject any access attempted without a tenant scope.
      throw new Error("DataStore: a tenant scope is required");
    }
    this.tenant = tenant;
    this.root = path.join(rootDir, ".data", tenant);
  }

  private get stateFile() {
    return path.join(this.root, "state.json");
  }

  private get storageKey() {
    return this.stateFile;
  }

  private async ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
  }

  private async atomicWrite(file: string, contents: string) {
    await this.ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, contents, "utf8");
    await fs.rename(tmp, file);
  }

  private async readState(): Promise<AppState> {
    try {
      const raw = await fs.readFile(this.stateFile, "utf8");
      const env = JSON.parse(raw) as Envelope;
      if (env.tenant !== this.tenant) {
        throw new Error(`DataStore: tenant mismatch (${env.tenant} != ${this.tenant})`);
      }
      // Mirror the durable snapshot into memory so later writes on a host
      // where disk isn't usable build on the latest persisted state.
      const normalized = normalizeState(env.state);
      memoryState.set(this.storageKey, copyState(normalized));
      return copyState(normalized);
    } catch {
      // No file yet (the expected case on a fresh deploy), a corrupt/mismatched
      // one, or a host where disk reads don't work at all — in every case fall
      // back to the in-memory tier instead of throwing, so the Server
      // Component that renders the app shell never crashes. This alone isn't
      // evidence disk is broken, so it doesn't warn; saveState's own write
      // attempt below is what surfaces a genuine persistence failure.
      const cached = memoryState.get(this.storageKey);
      if (cached) return copyState(cached);
      const seeded = buildSeedState();
      await this.persistState(seeded);
      return copyState(seeded);
    }
  }

  private async persistState(state: AppState): Promise<void> {
    // The in-memory tier is always authoritative for the current process; this
    // is what lets reads and subsequent writes succeed even when disk doesn't.
    memoryState.set(this.storageKey, copyState(state));
    const env: Envelope = { tenant: this.tenant, updatedAt: new Date().toISOString(), state };
    try {
      await this.atomicWrite(this.stateFile, JSON.stringify(env, null, 2));
    } catch (err: unknown) {
      warnReadOnly(err);
    }
  }

  async getState(): Promise<AppState> {
    return this.readState();
  }

  async updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState> {
    const previous = stateQueues.get(this.storageKey) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const draft = await this.readState();
      await mutate(draft);
      await this.persistState(draft);
      return copyState(draft);
    });
    stateQueues.set(this.storageKey, operation.then(() => undefined, () => undefined));
    return operation;
  }

  async appendNight(
    pageId: string,
    runId: string,
    input: Omit<Night, "i" | "runId" | "rawReportKey">,
    rawReport?: unknown,
  ): Promise<{ state: AppState; night: Night | null; inserted: boolean }> {
    let committed: Night | null = null;
    let inserted = false;
    const state = await this.updateState(async (draft) => {
      const page = draft.pages.find((p) => p.id === pageId);
      if (!page) return;

      const existing = page.history.find((n) => n.runId === runId);
      if (existing) {
        committed = existing;
        return;
      }

      // A result from a superseded/stale job must never overwrite the current
      // run. Requiring the active id also coalesces duplicate executions.
      if (page.runState !== "running" || page.runId !== runId) return;

      const i = page.history.reduce((max, item) => Math.max(max, item.i), -1) + 1;
      const rawReportKey = `run-${runId}`;
      const agent = input.agent?.map((check) => {
        const before = page.agent.find((prior) => prior.name === check.name);
        return { ...check, regressed: !!before && before.pass && !check.pass };
      });
      const night: Night = { ...input, i, runId, rawReportKey, agent };

      // Keep the filesystem adapter's sequential/object fan-out inside the
      // same per-tenant serialization boundary as the state commit.
      await this.appendLine(path.join(this.root, "history", `${pageId}.jsonl`), night);
      if (rawReport !== undefined) {
        await this.putReport(pageId, rawReportKey, {
          ...((rawReport && typeof rawReport === "object") ? rawReport : { payload: rawReport }),
          pageId,
          runId,
          i,
          date: night.date,
          iso: night.iso,
          agent,
        });
      }

      page.history.push(night);
      page.current = {
        mobile: mediansOf(night.scores.mobile),
        desktop: mediansOf(night.scores.desktop),
      };
      page.agent = agent ?? [];
      page.status = page.baseline && page.baselineCapturedAt
        ? classifyStatus(mediansOf(page.baseline.mobile), page.history, "mobile")
        : "pending";
      page.runState = undefined;
      page.lastRunAt = night.iso ?? new Date().toISOString();
      delete page.lastError;
      committed = night;
      inserted = true;
    });
    return { state, night: committed, inserted };
  }

  async addMarker(
    pageId: string,
    input: Omit<ChangeMarker, "i">,
    mutate?: (state: AppState, marker: ChangeMarker) => void,
  ): Promise<AppState> {
    return this.updateState(async (state) => {
      const page = state.pages.find((p) => p.id === pageId);
      if (!page) throw new Error(`addMarker: page ${pageId} not found`);
      if (page.markers.some((item) => item.id === input.id)) return;
      const marker: ChangeMarker = { ...input, i: resolveMarkerIndex(page.history, input.date) };
      await this.appendLine(path.join(this.root, "markers", `${pageId}.jsonl`), marker);
      page.markers = [...(page.markers || []), marker];
      mutate?.(state, marker);
    });
  }

  async putReport(pageId: string, key: string, payload: unknown): Promise<void> {
    const file = path.join(this.root, "reports", pageId, `${key}.json`);
    try {
      await this.atomicWrite(file, JSON.stringify({ tenant: this.tenant, payload }, null, 2));
    } catch (err: unknown) {
      warnReadOnly(err);
    }
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    try {
      const raw = await fs.readFile(path.join(this.root, "reports", pageId, `${key}.json`), "utf8");
      return (JSON.parse(raw) as { payload: unknown }).payload;
    } catch {
      // Missing file, or a host where report reads don't work at all.
      return null;
    }
  }

  /** Append one JSONL record; best-effort, never throws. */
  private async appendLine(file: string, record: object): Promise<void> {
    try {
      await this.ensureDir(path.dirname(file));
      await fs.appendFile(file, `${JSON.stringify({ tenant: this.tenant, ...record })}\n`, "utf8");
    } catch (err: unknown) {
      warnReadOnly(err);
    }
  }
}

/** Helper reused by page-status recompute callers. */
export function recomputeStatus(page: WatchPage): void {
  page.status = page.baseline && page.baselineCapturedAt
    ? classifyStatus(mediansOf(page.baseline.mobile), page.history, "mobile")
    : "pending";
}

export function createFsStore(tenant: string, rootDir?: string): DataStore {
  return new FsDataStore(tenant, rootDir);
}
