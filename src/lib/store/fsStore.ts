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
      return env.state;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        // First read: seed and persist.
        const seeded = buildSeedState();
        await this.saveState(seeded);
        return seeded;
      }
      throw err;
    }
  }

  async saveState(state: AppState): Promise<void> {
    const env: Envelope = { tenant: this.tenant, updatedAt: new Date().toISOString(), state };
    await this.atomicWrite(this.stateFile, JSON.stringify(env, null, 2));
  }

  async appendNight(pageId: string, night: Night, rawReport?: unknown): Promise<AppState> {
    // Sequential append (REQ-004).
    const seqFile = path.join(this.root, "history", `${pageId}.jsonl`);
    await this.ensureDir(path.dirname(seqFile));
    await fs.appendFile(seqFile, `${JSON.stringify({ tenant: this.tenant, ...night })}\n`, "utf8");

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
    const seqFile = path.join(this.root, "markers", `${pageId}.jsonl`);
    await this.ensureDir(path.dirname(seqFile));
    await fs.appendFile(seqFile, `${JSON.stringify({ tenant: this.tenant, ...marker })}\n`, "utf8");
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
    await this.atomicWrite(file, JSON.stringify({ tenant: this.tenant, payload }, null, 2));
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    try {
      const raw = await fs.readFile(path.join(this.root, "reports", pageId, `${key}.json`), "utf8");
      return (JSON.parse(raw) as { payload: unknown }).payload;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
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
