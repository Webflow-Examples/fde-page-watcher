import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AppState, ChangeMarker, CollectionJob, Night } from "../types";
import { buildInitialState } from "../seed";
import { mediansOf, pageTrend } from "../scoring";
import { resolveMarkerIndex } from "../followups";
import { normalizeState, type DataStore } from "./fsStore";
import { getEnv } from "../env";

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
 * Cloudflare-backed DataStore: AppState lives in D1 behind a version-guarded
 * compare-and-swap, history/markers are mirrored to append-only D1 rows, and
 * raw report payloads live in R2. All state mutations use the same atomic
 * update contract as the filesystem adapter.
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
      const seeded = buildInitialState(getEnv("DATASET_MODE"));
      const now = new Date().toISOString();
      await DB.prepare(
        "INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(tenant) DO NOTHING",
      )
        .bind(this.tenant, JSON.stringify(seeded), now)
        .run();
      return this.getState();
    }
    return normalizeState(JSON.parse(row.json) as AppState);
  }

  /**
   * Re-read, mutate, and conditionally commit the tenant blob. A lost race
   * reloads the latest version and reapplies the state-only mutation.
   */
  async updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState> {
    const { DB } = cfEnv();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const row = await DB.prepare("SELECT json, version FROM state WHERE tenant = ?").bind(this.tenant).first<StateRow>();
      const now = new Date().toISOString();

      if (!row) {
        const state = buildInitialState(getEnv("DATASET_MODE"));
        await mutate(state);
        const result = await DB.prepare(
          "INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(tenant) DO NOTHING",
        )
          .bind(this.tenant, JSON.stringify(state), now)
          .run();
        if ((result.meta.rows_written ?? 0) > 0) {
          await this.syncJobs([], state.jobs ?? []);
          return structuredClone(state);
        }
        continue;
      }

      const state = normalizeState(JSON.parse(row.json) as AppState);
      const jobsBefore = structuredClone(state.jobs ?? []);
      await mutate(state);
      const result = await DB.prepare(
        "UPDATE state SET json = ?, version = version + 1, updated_at = ? WHERE tenant = ? AND version = ?",
      )
        .bind(JSON.stringify(state), now, this.tenant, row.version)
        .run();
      if ((result.meta.rows_written ?? 0) > 0) {
        await this.syncJobs(jobsBefore, state.jobs ?? []);
        return structuredClone(state);
      }
    }
    throw new Error("DataStore: state update retry exhausted");
  }

  async appendNight(
    pageId: string,
    runId: string,
    input: Omit<Night, "i" | "runId" | "rawReportKey">,
    rawReport?: unknown,
  ): Promise<{ state: AppState; night: Night | null; inserted: boolean }> {
    const commit: { night: Night | null; inserted: boolean } = { night: null, inserted: false };
    const state = await this.updateState((draft) => {
      const page = draft.pages.find((item) => item.id === pageId);
      if (!page) return;

      const existing = page.history.find((item) => item.runId === runId);
      if (existing) {
        commit.night = existing;
        commit.inserted = false;
        return;
      }
      if (page.runState !== "running" || page.runId !== runId) return;

      const i = page.history.reduce((max, item) => Math.max(max, item.i), -1) + 1;
      const rawReportKey = `run-${runId}`;
      const agent = input.agent?.map((check) => {
        const before = page.agent.find((prior) => prior.name === check.name);
        return { ...check, regressed: !!before && before.pass && !check.pass };
      });
      const night: Night = { ...input, i, runId, rawReportKey, agent };

      page.history.push(night);
      if (page.history.length > 180) page.history = page.history.slice(-180);
      page.current = {
        mobile: mediansOf(night.scores.mobile),
        desktop: mediansOf(night.scores.desktop),
      };
      page.agent = agent ?? [];
      page.status = pageTrend(page, "mobile");
      page.runState = undefined;
      page.lastRunAt = night.iso ?? new Date().toISOString();
      delete page.lastError;
      commit.night = night;
      commit.inserted = true;
    });

    if (commit.night) {
      const { DB } = cfEnv();
      await DB.prepare("INSERT OR IGNORE INTO history (tenant, page_id, i, night_json) VALUES (?, ?, ?, ?)")
        .bind(this.tenant, pageId, commit.night.i, JSON.stringify(commit.night))
        .run();
      if (rawReport !== undefined) {
        await this.putReport(pageId, commit.night.rawReportKey!, {
          ...((rawReport && typeof rawReport === "object") ? rawReport : { payload: rawReport }),
          pageId,
          runId,
          i: commit.night.i,
          date: commit.night.date,
          iso: commit.night.iso,
          agent: commit.night.agent,
        });
      }
    }

    return { state, night: commit.night, inserted: commit.inserted };
  }

  async addMarker(
    pageId: string,
    input: Omit<ChangeMarker, "i">,
    mutate?: (state: AppState, marker: ChangeMarker) => void,
  ): Promise<AppState> {
    const commit: { marker: ChangeMarker | null } = { marker: null };
    const state = await this.updateState((draft) => {
      const page = draft.pages.find((item) => item.id === pageId);
      if (!page) throw new Error(`addMarker: page ${pageId} not found`);
      const existing = page.markers.find((item) => item.id === input.id);
      if (existing) {
        commit.marker = existing;
        return;
      }
      const marker: ChangeMarker = { ...input, i: resolveMarkerIndex(page.history, input.date) };
      page.markers = [...(page.markers ?? []), marker];
      mutate?.(draft, marker);
      commit.marker = marker;
    });

    if (commit.marker) {
      const { DB } = cfEnv();
      await DB.prepare("INSERT OR REPLACE INTO markers (tenant, page_id, id, marker_json) VALUES (?, ?, ?, ?)")
        .bind(this.tenant, pageId, commit.marker.id, JSON.stringify(commit.marker))
        .run();
    }
    return state;
  }

  async putReport(pageId: string, key: string, payload: unknown): Promise<void> {
    const { REPORTS } = cfEnv();
    await REPORTS.put(`${this.tenant}/${pageId}/${key}.json`, JSON.stringify({ tenant: this.tenant, payload }));
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    const { REPORTS } = cfEnv();
    const object = await REPORTS.get(`${this.tenant}/${pageId}/${key}.json`);
    if (!object) return null;
    const parsed = (await object.json()) as { payload: unknown };
    return parsed.payload;
  }

  async deleteReport(pageId: string, key: string): Promise<void> {
    const { REPORTS } = cfEnv();
    await REPORTS.delete(`${this.tenant}/${pageId}/${key}.json`);
  }

  private async syncJobs(before: CollectionJob[], after: CollectionJob[]): Promise<void> {
    const previous = new Map(before.map((job) => [job.id, JSON.stringify(job)]));
    const next = new Map(after.map((job) => [job.id, JSON.stringify(job)]));
    const { DB } = cfEnv();
    for (const job of after) {
      if (previous.get(job.id) === next.get(job.id)) continue;
      await DB.prepare(
        "INSERT INTO collection_jobs (tenant, id, page_id, state, job_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(tenant, id) DO UPDATE SET page_id = excluded.page_id, state = excluded.state, job_json = excluded.job_json, updated_at = excluded.updated_at",
      )
        .bind(this.tenant, job.id, job.pageId, job.state, JSON.stringify(job), job.updatedAt)
        .run();
    }
    for (const job of before) {
      if (next.has(job.id)) continue;
      await DB.prepare("DELETE FROM collection_jobs WHERE tenant = ? AND id = ?").bind(this.tenant, job.id).run();
    }
  }
}

export function createCfStore(tenant: string): DataStore {
  return new CfDataStore(tenant);
}
