import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AppState, ChangeMarker, Night } from "../types";
import { buildSeedState } from "../seed";
import { classifyStatus, mediansOf } from "../scoring";
import type { DataStore } from "./fsStore";

interface CfEnv {
  DB: D1Database;
  REPORTS: R2Bucket;
}

function cfEnv(): CfEnv {
  return getCloudflareContext().env as unknown as CfEnv;
}

interface StateRow {
  json: string;
  version: number;
}

/**
 * Cloudflare-backed DataStore: the AppState blob lives in D1 behind a
 * version-guarded compare-and-swap (see withState), history/markers are
 * append-only D1 rows, and raw report payloads live in R2. Mirrors
 * fsStore.ts's behavior exactly so call sites never change.
 */
class CfDataStore implements DataStore {
  readonly tenant: string;

  constructor(tenant: string) {
    if (!tenant || !tenant.trim()) {
      throw new Error("DataStore: a tenant scope is required");
    }
    this.tenant = tenant;
  }

  async getState(): Promise<AppState> {
    const { DB } = cfEnv();
    const row = await DB.prepare("SELECT json FROM state WHERE tenant = ?").bind(this.tenant).first<StateRow>();
    if (!row) {
      const seeded = buildSeedState();
      const now = new Date().toISOString();
      await DB.prepare(
        "INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(tenant) DO NOTHING",
      )
        .bind(this.tenant, JSON.stringify(seeded), now)
        .run();
      return this.getState();
    }
    return JSON.parse(row.json) as AppState;
  }

  async saveState(state: AppState): Promise<void> {
    const { DB } = cfEnv();
    const now = new Date().toISOString();
    await DB.prepare(
      `INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(tenant) DO UPDATE SET json = excluded.json, version = version + 1, updated_at = excluded.updated_at`,
    )
      .bind(this.tenant, JSON.stringify(state), now)
      .run();
  }

  /**
   * Read-modify-write the AppState blob under a version-guarded retry loop, so
   * concurrent server-side callers (a nightly run appending several pages back
   * to back, "Run now" racing a marker POST) never silently clobber each other.
   * The client's whole-state PUT (saveState above) has no version token to
   * guard with, so it stays last-writer-wins by design.
   */
  private async withState(mutate: (state: AppState) => void): Promise<AppState> {
    const { DB } = cfEnv();
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await DB.prepare("SELECT json, version FROM state WHERE tenant = ?").bind(this.tenant).first<StateRow>();
      const now = new Date().toISOString();

      if (!row) {
        const state = buildSeedState();
        mutate(state);
        const res = await DB.prepare(
          "INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(tenant) DO NOTHING",
        )
          .bind(this.tenant, JSON.stringify(state), now)
          .run();
        if ((res.meta.rows_written ?? 0) > 0) return state;
        continue;
      }

      const state = JSON.parse(row.json) as AppState;
      mutate(state);
      const res = await DB.prepare("UPDATE state SET json = ?, version = version + 1, updated_at = ? WHERE tenant = ? AND version = ?")
        .bind(JSON.stringify(state), now, this.tenant, row.version)
        .run();
      if ((res.meta.rows_written ?? 0) > 0) return state;
      // Lost the race to another writer — reload and retry.
    }
    throw new Error("DataStore: state update retry exhausted");
  }

  async appendNight(pageId: string, night: Night, rawReport?: unknown): Promise<AppState> {
    const { DB } = cfEnv();
    await DB.prepare("INSERT OR REPLACE INTO history (tenant, page_id, i, night_json) VALUES (?, ?, ?, ?)")
      .bind(this.tenant, pageId, night.i, JSON.stringify(night))
      .run();

    if (rawReport !== undefined && night.rawReportKey) {
      await this.putReport(pageId, night.rawReportKey, rawReport);
    }

    return this.withState((state) => {
      const page = state.pages.find((p) => p.id === pageId);
      if (!page) return;
      page.history.push(night);
      page.current = {
        mobile: mediansOf(night.scores.mobile),
        desktop: mediansOf(night.scores.desktop),
      };
      page.status = classifyStatus(mediansOf(page.baseline.mobile), page.history, "mobile");
    });
  }

  async addMarker(pageId: string, marker: ChangeMarker): Promise<AppState> {
    const { DB } = cfEnv();
    // Keyed by the marker's stable id, not `i` — multiple markers can resolve
    // to the same history index (`i` is derived from the marker's date).
    await DB.prepare("INSERT OR REPLACE INTO markers (tenant, page_id, id, marker_json) VALUES (?, ?, ?, ?)")
      .bind(this.tenant, pageId, marker.id, JSON.stringify(marker))
      .run();

    return this.withState((state) => {
      const page = state.pages.find((p) => p.id === pageId);
      if (!page) return;
      page.markers = [...(page.markers || []), marker];
    });
  }

  async putReport(pageId: string, key: string, payload: unknown): Promise<void> {
    const { REPORTS } = cfEnv();
    await REPORTS.put(`${this.tenant}/${pageId}/${key}.json`, JSON.stringify({ tenant: this.tenant, payload }));
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    const { REPORTS } = cfEnv();
    const obj = await REPORTS.get(`${this.tenant}/${pageId}/${key}.json`);
    if (!obj) return null;
    const parsed = (await obj.json()) as { payload: unknown };
    return parsed.payload;
  }
}

export function createCfStore(tenant: string): DataStore {
  return new CfDataStore(tenant);
}
