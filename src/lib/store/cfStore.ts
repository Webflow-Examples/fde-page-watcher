import { getCloudflareContext } from "@opennextjs/cloudflare";
import { TENANT, type AppState, type ChangeMarker, type CollectionJob, type Night } from "../types";
import { buildInitialState, buildSeedCruxEvidence, DEMO_DATA_VERSION } from "../seed";
import { captureAgentReadiness } from "../agentScoring";
import { normalizePerformanceThresholds } from "../performanceThresholds";
import { mediansOf, pageTrend } from "../scoring";
import { resolveMarkerIndex } from "../followups";
import type { DataStore } from "./fsStore";
import { normalizeState } from "./normalize";
import {
  HISTORY_STORAGE_VERSION,
  hydrateTableHistory,
  stateWithoutEmbeddedHistory,
  type StoredHistoryRow,
} from "./historyState";
import { getEnv } from "../env";
import {
  cruxEvidenceFromRows,
  type CruxPageEvidence,
  type CruxSnapshotRow,
  type CruxStatusRow,
} from "../crux";
import {
  EXTERNAL_AGENT_AUDIT_SNAPSHOT_QUERY,
  EXTERNAL_AGENT_AUDIT_STATUS_QUERY,
  externalAgentAuditsFromRows,
  type ExternalAgentAuditSnapshotRow,
  type ExternalAgentAuditStatusRow,
  type ExternalAgentOriginAudit,
} from "../agentAudit";

export interface CfEnv {
  DB: D1Database;
  REPORTS: R2Bucket;
}

export function getLocalCloudflareBindings(): CfEnv {
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

  private async materializedState(DB: D1Database, value: AppState): Promise<AppState> {
    const state = normalizeState(value);
    if (state.historyStorageVersion !== HISTORY_STORAGE_VERSION) return state;
    const history = await DB.prepare(
      "SELECT page_id, i, night_json FROM history WHERE tenant = ? ORDER BY page_id, i",
    ).bind(this.tenant).all<StoredHistoryRow>();
    return normalizeState(hydrateTableHistory(state, history.results));
  }

  private async syncHistory(before: AppState, after: AppState): Promise<void> {
    const { DB } = getLocalCloudflareBindings();
    const beforeRows = new Map(before.pages.flatMap((page) => page.history.map((night) => [
      `${page.id}:${night.i}`,
      JSON.stringify(night),
    ])));
    const afterKeys = new Set(after.pages.flatMap((page) => page.history.map((night) => `${page.id}:${night.i}`)));
    const stored = await DB.prepare(
      "SELECT page_id, i, night_json FROM history WHERE tenant = ?",
    ).bind(this.tenant).all<StoredHistoryRow>();
    const statements: D1PreparedStatement[] = [];
    for (const page of after.pages) {
      for (const night of page.history) {
        if (beforeRows.get(`${page.id}:${night.i}`) === JSON.stringify(night)) continue;
        statements.push(DB.prepare(
          "INSERT INTO history (tenant, page_id, i, night_json) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(tenant, page_id, i) DO UPDATE SET night_json = excluded.night_json",
        ).bind(this.tenant, page.id, night.i, JSON.stringify(night)));
      }
    }
    for (const row of stored.results) {
      if (afterKeys.has(`${row.page_id}:${row.i}`)) continue;
      statements.push(DB.prepare("DELETE FROM history WHERE tenant = ? AND page_id = ? AND i = ?")
        .bind(this.tenant, row.page_id, row.i));
    }
    for (const statement of statements) await statement.run();
  }

  async getState(): Promise<AppState> {
    const { DB } = getLocalCloudflareBindings();
    const row = await DB.prepare("SELECT json FROM state WHERE tenant = ?").bind(this.tenant).first<StateRow>();
    if (!row) {
      const seeded = buildInitialState(getEnv("DATASET_MODE"));
      const now = new Date().toISOString();
      const inserted = await DB.prepare(
        "INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(tenant) DO NOTHING",
      )
        .bind(this.tenant, JSON.stringify(stateWithoutEmbeddedHistory(seeded)), now)
        .run();
      if ((inserted.meta.rows_written ?? 0) > 0) {
        await this.syncHistory({ pages: [], recs: [] }, seeded);
      }
      return this.getState();
    }
    const state = await this.materializedState(DB, JSON.parse(row.json) as AppState);
    if (
      this.tenant === TENANT
      && getEnv("DATASET_MODE") !== "live"
      && state.demoDataVersion !== DEMO_DATA_VERSION
    ) {
      const seeded = buildInitialState("demo");
      return this.updateState((draft) => {
        for (const key of Object.keys(draft) as Array<keyof AppState>) delete draft[key];
        Object.assign(draft, structuredClone(seeded));
      });
    }
    return state;
  }

  async getCruxEvidence(): Promise<CruxPageEvidence[]> {
    const { DB } = getLocalCloudflareBindings();
    const [snapshots, statuses] = await Promise.all([
      DB.prepare(
        "SELECT page_id, form_factor, scope, requested_url, effective_url, collection_start, collection_end, " +
          "fetched_at, lcp_p75_ms, inp_p75_ms, cls_p75, ttfb_p75_ms, metrics_json " +
          "FROM crux_snapshots WHERE tenant = ? ORDER BY page_id, form_factor, collection_end DESC",
      ).bind(this.tenant).all<CruxSnapshotRow>(),
      DB.prepare(
        "SELECT page_id, form_factor, status, effective_scope, latest_collection_end, last_attempted_at, " +
          "last_succeeded_at, error_code, error_message FROM crux_status WHERE tenant = ? " +
          "ORDER BY page_id, form_factor",
      ).bind(this.tenant).all<CruxStatusRow>(),
    ]);
    const evidence = cruxEvidenceFromRows(snapshots.results, statuses.results);
    return evidence.length === 0 && this.tenant === TENANT && getEnv("DATASET_MODE") !== "live"
      ? buildSeedCruxEvidence()
      : evidence;
  }

  async getExternalAgentAudits(): Promise<ExternalAgentOriginAudit[]> {
    const { DB } = getLocalCloudflareBindings();
    const [snapshots, statuses] = await Promise.all([
      DB.prepare(EXTERNAL_AGENT_AUDIT_SNAPSHOT_QUERY)
        .bind(this.tenant).all<ExternalAgentAuditSnapshotRow>(),
      DB.prepare(EXTERNAL_AGENT_AUDIT_STATUS_QUERY)
        .bind(this.tenant).all<ExternalAgentAuditStatusRow>(),
    ]);
    return externalAgentAuditsFromRows(snapshots.results, statuses.results);
  }

  /**
   * Re-read, mutate, and conditionally commit the tenant blob. A lost race
   * reloads the latest version and reapplies the state-only mutation.
   */
  async updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState> {
    const { DB } = getLocalCloudflareBindings();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const row = await DB.prepare("SELECT json, version FROM state WHERE tenant = ?").bind(this.tenant).first<StateRow>();
      const now = new Date().toISOString();

      if (!row) {
        const state = buildInitialState(getEnv("DATASET_MODE"));
        await mutate(state);
        const result = await DB.prepare(
          "INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(tenant) DO NOTHING",
        )
          .bind(this.tenant, JSON.stringify(stateWithoutEmbeddedHistory(state)), now)
          .run();
        if ((result.meta.rows_written ?? 0) > 0) {
          await this.syncJobs([], state.jobs ?? []);
          await this.syncHistory({ pages: [], recs: [] }, state);
          return structuredClone(state);
        }
        continue;
      }

      const state = await this.materializedState(DB, JSON.parse(row.json) as AppState);
      const stateBefore = structuredClone(state);
      const jobsBefore = structuredClone(state.jobs ?? []);
      const markersBefore = new Set(state.pages.flatMap((page) => page.markers.map((marker) => `${page.id}:${marker.id}`)));
      await mutate(state);
      const result = await DB.prepare(
        "UPDATE state SET json = ?, version = version + 1, updated_at = ? WHERE tenant = ? AND version = ?",
      )
        .bind(JSON.stringify(stateWithoutEmbeddedHistory(state)), now, this.tenant, row.version)
        .run();
      if ((result.meta.rows_written ?? 0) > 0) {
        await this.syncJobs(jobsBefore, state.jobs ?? []);
        await this.syncHistory(stateBefore, state);
        const { DB } = getLocalCloudflareBindings();
        const markerStatements = state.pages.flatMap((page) => page.markers.map((marker) =>
          DB.prepare("INSERT OR REPLACE INTO markers (tenant, page_id, id, marker_json) VALUES (?, ?, ?, ?)")
            .bind(this.tenant, page.id, marker.id, JSON.stringify(marker)),
        ));
        const markersAfter = new Set(state.pages.flatMap((page) => page.markers.map((marker) => `${page.id}:${marker.id}`)));
        for (const key of markersBefore) {
          if (markersAfter.has(key)) continue;
          const separator = key.indexOf(":");
          markerStatements.push(
            DB.prepare("DELETE FROM markers WHERE tenant = ? AND page_id = ? AND id = ?")
              .bind(this.tenant, key.slice(0, separator), key.slice(separator + 1)),
          );
        }
        for (const statement of markerStatements) await statement.run();
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
      const agentReadiness = input.agentReadiness
        ?? (agent ? captureAgentReadiness(agent, page.agentIgnores, draft.agentIgnoreDefaults, page.agentIgnoreRestores) : undefined);
      const night: Night = { ...input, i, runId, rawReportKey, agent, agentReadiness };

      page.history.push(night);
      if (page.history.length > 180) page.history = page.history.slice(-180);
      page.current = {
        mobile: mediansOf(night.scores.mobile),
        desktop: mediansOf(night.scores.desktop),
      };
      page.agent = agent ?? [];
      page.status = pageTrend(page, "mobile", normalizePerformanceThresholds(draft.performanceThresholds));
      page.runState = undefined;
      page.lastRunAt = night.iso ?? new Date().toISOString();
      page.lastCollectionStatus = "trusted";
      delete page.lastError;
      commit.night = night;
      commit.inserted = true;
    });

    if (commit.night) {
      if (rawReport !== undefined) {
        await this.putReport(pageId, commit.night.rawReportKey!, {
          ...((rawReport && typeof rawReport === "object") ? rawReport : { payload: rawReport }),
          pageId,
          runId,
          i: commit.night.i,
          date: commit.night.date,
          iso: commit.night.iso,
          agent: commit.night.agent,
          agentReadiness: commit.night.agentReadiness,
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
      const existing = page.markers.find((item) =>
        item.id === input.id || (!!input.recKey && item.recKey === input.recKey),
      );
      if (existing) {
        Object.assign(existing, input, { id: existing.id, i: resolveMarkerIndex(page.history, input.date) });
        mutate?.(draft, existing);
        commit.marker = existing;
        return;
      }
      const marker: ChangeMarker = { ...input, i: resolveMarkerIndex(page.history, input.date) };
      page.markers = [...(page.markers ?? []), marker];
      mutate?.(draft, marker);
      commit.marker = marker;
    });

    if (commit.marker) {
      const { DB } = getLocalCloudflareBindings();
      await DB.prepare("INSERT OR REPLACE INTO markers (tenant, page_id, id, marker_json) VALUES (?, ?, ?, ?)")
        .bind(this.tenant, pageId, commit.marker.id, JSON.stringify(commit.marker))
        .run();
    }
    return state;
  }

  async putReport(pageId: string, key: string, payload: unknown): Promise<void> {
    const { REPORTS } = getLocalCloudflareBindings();
    await REPORTS.put(`${this.tenant}/${pageId}/${key}.json`, JSON.stringify({ tenant: this.tenant, payload }));
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    const { REPORTS } = getLocalCloudflareBindings();
    const object = await REPORTS.get(`${this.tenant}/${pageId}/${key}.json`);
    if (!object) return null;
    const parsed = (await object.json()) as { payload: unknown };
    return parsed.payload;
  }

  async deleteReport(pageId: string, key: string): Promise<void> {
    const { REPORTS } = getLocalCloudflareBindings();
    await REPORTS.delete(`${this.tenant}/${pageId}/${key}.json`);
  }

  private async syncJobs(before: CollectionJob[], after: CollectionJob[]): Promise<void> {
    const previous = new Map(before.map((job) => [job.id, JSON.stringify(job)]));
    const next = new Map(after.map((job) => [job.id, JSON.stringify(job)]));
    const { DB } = getLocalCloudflareBindings();
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
