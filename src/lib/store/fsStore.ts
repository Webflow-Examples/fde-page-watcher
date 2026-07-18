import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppState, ChangeMarker, Night, WatchPage } from "../types";
import { buildSeedState } from "../seed";
import { classifyStatus, mediansOf } from "../scoring";

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
  saveState(state: AppState): Promise<void>;
  /** Nightly write fan-out: sequential history append + snapshot update + raw report (REQ-016). */
  appendNight(pageId: string, night: Night, rawReport?: unknown): Promise<AppState>;
  addMarker(pageId: string, marker: ChangeMarker): Promise<AppState>;
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
 * working on hosts where the app directory is read-only (serverless/edge
 * deployments only allow writes to an ephemeral temp dir, if at all). Disk is
 * still the source of truth wherever it is writable; memory is the fallback so
 * a Server Component render never crashes the whole app when a write is denied.
 */
const memoryState = new Map<string, AppState>();

/** Errno codes that mean "this filesystem is not writable/usable here". */
const READ_ONLY_CODES = new Set(["ENOENT", "ENOTDIR", "EROFS", "EACCES", "EPERM"]);

function isReadOnlyFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code !== undefined && READ_ONLY_CODES.has(code);
}

let warnedReadOnly = false;
function warnReadOnly(err: unknown): void {
  if (warnedReadOnly) return;
  warnedReadOnly = true;
  console.warn(
    "[DataStore] filesystem is not writable; falling back to in-memory state " +
      "for this process. State will not persist across restarts or instances. " +
      "Configure a durable DataStore adapter for production.",
    (err as Error)?.message,
  );
}

class FsDataStore implements DataStore {
  readonly tenant: string;
  private root: string;

  constructor(tenant: string) {
    if (!tenant || !tenant.trim()) {
      // REQ-031: reject any access attempted without a tenant scope.
      throw new Error("DataStore: a tenant scope is required");
    }
    this.tenant = tenant;
    this.root = path.join(process.cwd(), ".data", tenant);
  }

  private get stateFile() {
    return path.join(this.root, "state.json");
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

  async getState(): Promise<AppState> {
    try {
      const raw = await fs.readFile(this.stateFile, "utf8");
      const env = JSON.parse(raw) as Envelope;
      if (env.tenant !== this.tenant) {
        throw new Error(`DataStore: tenant mismatch (${env.tenant} != ${this.tenant})`);
      }
      // Mirror the durable snapshot into memory so later writes on a read-only
      // host build on the latest persisted state.
      memoryState.set(this.tenant, env.state);
      return env.state;
    } catch (err: unknown) {
      // ENOENT: nothing persisted yet. Other read-only codes: the data dir
      // can't be created or read (read-only serverless/edge filesystem). In
      // both cases fall back to the in-memory tier instead of throwing, so the
      // Server Component that renders the app shell never crashes.
      if (isReadOnlyFsError(err)) {
        const cached = memoryState.get(this.tenant);
        if (cached) return cached;
        const seeded = buildSeedState();
        memoryState.set(this.tenant, seeded);
        // Best-effort persist; saveState swallows write failures on read-only hosts.
        await this.saveState(seeded);
        return seeded;
      }
      throw err;
    }
  }

  async saveState(state: AppState): Promise<void> {
    // The in-memory tier is always authoritative for the current process; this
    // is what lets reads and subsequent writes succeed on read-only hosts.
    memoryState.set(this.tenant, state);
    const env: Envelope = { tenant: this.tenant, updatedAt: new Date().toISOString(), state };
    try {
      await this.atomicWrite(this.stateFile, JSON.stringify(env, null, 2));
    } catch (err: unknown) {
      if (isReadOnlyFsError(err)) {
        warnReadOnly(err);
        return;
      }
      throw err;
    }
  }

  async appendNight(pageId: string, night: Night, rawReport?: unknown): Promise<AppState> {
    // Sequential append (REQ-004). Best-effort on read-only hosts.
    await this.appendLine(path.join(this.root, "history", `${pageId}.jsonl`), night);

    // Object storage for the raw payload (REQ-006).
    if (rawReport !== undefined && night.rawReportKey) {
      await this.putReport(pageId, night.rawReportKey, rawReport);
    }

    // Update the KV read model: push the night, refresh snapshot + status.
    const state = await this.getState();
    const page = state.pages.find((p) => p.id === pageId);
    if (page) {
      page.history.push(night);
      page.current = {
        mobile: mediansOf(night.scores.mobile),
        desktop: mediansOf(night.scores.desktop),
      };
      page.status = classifyStatus(mediansOf(page.baseline.mobile), page.history, "mobile");
      await this.saveState(state);
    }
    return state;
  }

  async addMarker(pageId: string, marker: ChangeMarker): Promise<AppState> {
    await this.appendLine(path.join(this.root, "markers", `${pageId}.jsonl`), marker);
    const state = await this.getState();
    const page = state.pages.find((p) => p.id === pageId);
    if (page) {
      page.markers = [...(page.markers || []), marker];
      await this.saveState(state);
    }
    return state;
  }

  async putReport(pageId: string, key: string, payload: unknown): Promise<void> {
    const file = path.join(this.root, "reports", pageId, `${key}.json`);
    try {
      await this.atomicWrite(file, JSON.stringify({ tenant: this.tenant, payload }, null, 2));
    } catch (err: unknown) {
      if (isReadOnlyFsError(err)) {
        warnReadOnly(err);
        return;
      }
      throw err;
    }
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    try {
      const raw = await fs.readFile(path.join(this.root, "reports", pageId, `${key}.json`), "utf8");
      return (JSON.parse(raw) as { payload: unknown }).payload;
    } catch (err: unknown) {
      // Missing file, or a read-only host where reports were never written.
      if (isReadOnlyFsError(err)) return null;
      throw err;
    }
  }

  /** Append one JSONL record, tolerating a read-only filesystem. */
  private async appendLine(file: string, record: object): Promise<void> {
    try {
      await this.ensureDir(path.dirname(file));
      await fs.appendFile(file, `${JSON.stringify({ tenant: this.tenant, ...record })}\n`, "utf8");
    } catch (err: unknown) {
      if (isReadOnlyFsError(err)) {
        warnReadOnly(err);
        return;
      }
      throw err;
    }
  }
}

/** Helper reused by page-status recompute callers. */
export function recomputeStatus(page: WatchPage): void {
  page.status = classifyStatus(mediansOf(page.baseline.mobile), page.history, "mobile");
}

export function createFsStore(tenant: string): DataStore {
  return new FsDataStore(tenant);
}
