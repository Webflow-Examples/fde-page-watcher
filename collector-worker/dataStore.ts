import { buildInitialState, buildSeedCruxEvidence, DEMO_DATA_VERSION } from "../src/lib/seed";
import { captureAgentReadiness } from "../src/lib/agentScoring";
import { resolveMarkerIndex } from "../src/lib/followups";
import { mediansOf, pageTrend } from "../src/lib/scoring";
import { effectivePerformanceThresholds } from "../src/lib/performanceThresholds";
import { normalizeState } from "../src/lib/store/normalize";
import { TENANT, type AppState, type ChangeMarker, type Night } from "../src/lib/types";
import {
  HISTORY_STORAGE_VERSION,
  hydrateTableHistory,
  stateWithoutEmbeddedHistory,
  type StoredHistoryRow,
} from "../src/lib/store/historyState";
import {
  cruxEvidenceFromRows,
  type CruxPageEvidence,
  type CruxSnapshotRow,
  type CruxStatusRow,
} from "../src/lib/crux";

export interface FdeStoreBindings {
  DB: D1Database;
  REPORTS: R2Bucket;
}

interface StateRow {
  json: string;
  version: number;
  updated_at: string;
}

export interface VersionedState {
  state: AppState;
  version: number;
  updatedAt: string;
}

export interface StateWriteResult {
  value?: VersionedState;
  conflict?: VersionedState;
}

function copyState(state: AppState): AppState {
  return structuredClone(state);
}

function emptyState(): AppState {
  return { pages: [], recs: [], jobs: [], followUps: [] };
}

/** D1/R2 implementation owned by the FDE account. */
export class FdeDataStore {
  readonly tenant: string;

  constructor(
    tenant: string,
    private readonly bindings: FdeStoreBindings,
    private readonly datasetMode: "demo" | "live" = tenant.endsWith(":live") ? "live" : "demo",
  ) {
    if (!tenant || !tenant.trim()) throw new Error("DataStore: a tenant scope is required");
    this.tenant = tenant;
  }

  private async rawState(): Promise<StateRow | null> {
    return this.bindings.DB.prepare("SELECT json, version, updated_at FROM state WHERE tenant = ?")
      .bind(this.tenant)
      .first<StateRow>();
  }

  private async materializedState(row: StateRow): Promise<AppState> {
    const state = normalizeState(JSON.parse(row.json) as AppState);
    if (state.historyStorageVersion !== HISTORY_STORAGE_VERSION) return state;
    const history = await this.bindings.DB.prepare(
      "SELECT page_id, i, night_json FROM history WHERE tenant = ? ORDER BY page_id, i",
    ).bind(this.tenant).all<StoredHistoryRow>();
    return normalizeState(hydrateTableHistory(state, history.results));
  }

  async readVersionedState(seed = true): Promise<VersionedState | null> {
    const row = await this.rawState();
    if (row) {
      const state = await this.materializedState(row);
      if (this.datasetMode === "demo" && this.tenant === TENANT && state.demoDataVersion !== DEMO_DATA_VERSION) {
        const refreshed = await this.writeVersionedState(buildInitialState("demo"), row.version);
        if (refreshed.value) return refreshed.value;
        return refreshed.conflict ?? this.readVersionedState(true);
      }
      return {
        state: copyState(state),
        version: row.version,
        updatedAt: row.updated_at,
      };
    }
    if (!seed) return null;

    const seeded = buildInitialState(this.datasetMode);
    const written = await this.writeVersionedState(seeded, null);
    if (written.value) return written.value;
    return written.conflict ?? this.readVersionedState(true);
  }

  async getCruxEvidence(): Promise<CruxPageEvidence[]> {
    const [snapshots, statuses] = await Promise.all([
      this.bindings.DB.prepare(
        "SELECT page_id, form_factor, scope, requested_url, effective_url, collection_start, collection_end, " +
          "fetched_at, lcp_p75_ms, inp_p75_ms, cls_p75, ttfb_p75_ms, metrics_json " +
          "FROM crux_snapshots WHERE tenant = ? ORDER BY page_id, form_factor, collection_end DESC",
      ).bind(this.tenant).all<CruxSnapshotRow>(),
      this.bindings.DB.prepare(
        "SELECT page_id, form_factor, status, effective_scope, latest_collection_end, last_attempted_at, " +
          "last_succeeded_at, error_code, error_message FROM crux_status WHERE tenant = ? " +
          "ORDER BY page_id, form_factor",
      ).bind(this.tenant).all<CruxStatusRow>(),
    ]);
    const evidence = cruxEvidenceFromRows(snapshots.results, statuses.results);
    return evidence.length === 0 && this.datasetMode === "demo" && this.tenant === TENANT
      ? buildSeedCruxEvidence()
      : evidence;
  }

  /** Compare-and-swap a complete state snapshot. `null` means create only. */
  async writeVersionedState(state: AppState, expectedVersion: number | null): Promise<StateWriteResult> {
    const normalized = normalizeState(copyState(state));
    const beforeRow = await this.rawState();
    const before = beforeRow ? await this.materializedState(beforeRow) : emptyState();
    if (expectedVersion === null ? !!beforeRow : !beforeRow || beforeRow.version !== expectedVersion) {
      return {
        conflict: beforeRow ? {
          state: copyState(before),
          version: beforeRow.version,
          updatedAt: beforeRow.updated_at,
        } : undefined,
      };
    }

    const updatedAt = new Date().toISOString();
    const json = JSON.stringify(stateWithoutEmbeddedHistory(normalized));
    const result = expectedVersion === null
      ? await this.bindings.DB.prepare(
        "INSERT INTO state (tenant, json, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(tenant) DO NOTHING",
      ).bind(this.tenant, json, updatedAt).run()
      : await this.bindings.DB.prepare(
        "UPDATE state SET json = ?, version = version + 1, updated_at = ? WHERE tenant = ? AND version = ?",
      ).bind(json, updatedAt, this.tenant, expectedVersion).run();

    if ((result.meta.rows_written ?? 0) < 1) {
      const conflict = await this.readVersionedState(false);
      return { conflict: conflict ?? undefined };
    }

    await this.syncDerived(before, normalized);
    return {
      value: {
        state: copyState(normalized),
        version: expectedVersion === null ? 0 : expectedVersion + 1,
        updatedAt,
      },
    };
  }

  async getState(): Promise<AppState> {
    const value = await this.readVersionedState(true);
    if (!value) throw new Error("DataStore: failed to initialize state");
    return value.state;
  }

  async updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.readVersionedState(true);
      if (!current) continue;
      const draft = copyState(current.state);
      await mutate(draft);
      const result = await this.writeVersionedState(draft, current.version);
      if (result.value) return result.value.state;
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
      page.status = pageTrend(page, "mobile", effectivePerformanceThresholds(draft.performanceThresholds, page));
      page.runState = undefined;
      page.lastRunAt = night.iso ?? new Date().toISOString();
      page.lastCollectionStatus = "trusted";
      delete page.lastError;
      commit.night = night;
      commit.inserted = true;
    });

    if (commit.night && rawReport !== undefined) {
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
    return { state, night: commit.night, inserted: commit.inserted };
  }

  async addMarker(
    pageId: string,
    input: Omit<ChangeMarker, "i">,
    mutate?: (state: AppState, marker: ChangeMarker) => void,
  ): Promise<AppState> {
    return this.updateState((draft) => {
      const page = draft.pages.find((item) => item.id === pageId);
      if (!page) throw new Error(`addMarker: page ${pageId} not found`);
      const existing = page.markers.find((item) =>
        item.id === input.id || (!!input.recKey && item.recKey === input.recKey),
      );
      if (existing) {
        Object.assign(existing, input, { id: existing.id, i: resolveMarkerIndex(page.history, input.date) });
        mutate?.(draft, existing);
        return;
      }
      const marker: ChangeMarker = { ...input, i: resolveMarkerIndex(page.history, input.date) };
      page.markers = [...(page.markers ?? []), marker];
      mutate?.(draft, marker);
    });
  }

  private reportKey(pageId: string, key: string): string {
    return `${this.tenant}/${pageId}/${key}.json`;
  }

  async putReport(pageId: string, key: string, payload: unknown): Promise<void> {
    await this.bindings.REPORTS.put(
      this.reportKey(pageId, key),
      JSON.stringify({ tenant: this.tenant, payload }),
      { httpMetadata: { contentType: "application/json" } },
    );
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    const object = await this.bindings.REPORTS.get(this.reportKey(pageId, key));
    if (!object) return null;
    const parsed = (await object.json()) as { payload: unknown };
    return parsed.payload;
  }

  async deleteReport(pageId: string, key: string): Promise<void> {
    await this.bindings.REPORTS.delete(this.reportKey(pageId, key));
  }

  async putReportEnvelope(pageId: string, key: string, envelope: string): Promise<void> {
    const parsed = JSON.parse(envelope) as { tenant?: unknown; payload?: unknown };
    if (parsed.tenant !== this.tenant || !("payload" in parsed)) throw new Error("Invalid report envelope");
    await this.bindings.REPORTS.put(this.reportKey(pageId, key), envelope, {
      httpMetadata: { contentType: "application/json" },
    });
  }

  private async runStatements(statements: D1PreparedStatement[]): Promise<void> {
    for (let index = 0; index < statements.length; index += 50) {
      await this.bindings.DB.batch(statements.slice(index, index + 50));
    }
  }

  private async syncDerived(before: AppState, after: AppState): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    const previousJobs = new Map((before.jobs ?? []).map((job) => [job.id, JSON.stringify(job)]));
    const nextJobs = new Map((after.jobs ?? []).map((job) => [job.id, JSON.stringify(job)]));
    for (const job of after.jobs ?? []) {
      if (previousJobs.get(job.id) === nextJobs.get(job.id)) continue;
      statements.push(this.bindings.DB.prepare(
        "INSERT INTO collection_jobs (tenant, id, page_id, state, job_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(tenant, id) DO UPDATE SET page_id = excluded.page_id, state = excluded.state, job_json = excluded.job_json, updated_at = excluded.updated_at",
      ).bind(this.tenant, job.id, job.pageId, job.state, JSON.stringify(job), job.updatedAt));
    }
    for (const job of before.jobs ?? []) {
      if (!nextJobs.has(job.id)) {
        statements.push(this.bindings.DB.prepare("DELETE FROM collection_jobs WHERE tenant = ? AND id = ?")
          .bind(this.tenant, job.id));
      }
    }

    const beforeHistory = new Map(before.pages.flatMap((page) => page.history.map((night) => [
      `${page.id}:${night.runId ?? night.i}`,
      JSON.stringify(night),
    ])));
    const afterHistoryKeys = new Set(after.pages.flatMap((page) =>
      page.history.map((night) => `${page.id}:${night.i}`)));
    const storedHistory = await this.bindings.DB.prepare(
      "SELECT page_id, i, night_json FROM history WHERE tenant = ?",
    ).bind(this.tenant).all<StoredHistoryRow>();
    const beforeMarkers = new Map(before.pages.flatMap((page) => page.markers.map((marker) => [`${page.id}:${marker.id}`, JSON.stringify(marker)])));
    const afterMarkerKeys = new Set(after.pages.flatMap((page) => page.markers.map((marker) => `${page.id}:${marker.id}`)));
    for (const page of after.pages) {
      for (const night of page.history) {
        if (beforeHistory.get(`${page.id}:${night.runId ?? night.i}`) === JSON.stringify(night)) continue;
        statements.push(this.bindings.DB.prepare(
          "INSERT INTO history (tenant, page_id, i, night_json) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(tenant, page_id, i) DO UPDATE SET night_json = excluded.night_json",
        ).bind(this.tenant, page.id, night.i, JSON.stringify(night)));
      }
      for (const marker of page.markers) {
        if (beforeMarkers.get(`${page.id}:${marker.id}`) === JSON.stringify(marker)) continue;
        statements.push(this.bindings.DB.prepare(
          "INSERT OR REPLACE INTO markers (tenant, page_id, id, marker_json) VALUES (?, ?, ?, ?)",
        ).bind(this.tenant, page.id, marker.id, JSON.stringify(marker)));
      }
    }
    for (const key of beforeMarkers.keys()) {
      if (afterMarkerKeys.has(key)) continue;
      const separator = key.indexOf(":");
      statements.push(this.bindings.DB.prepare(
        "DELETE FROM markers WHERE tenant = ? AND page_id = ? AND id = ?",
      ).bind(this.tenant, key.slice(0, separator), key.slice(separator + 1)));
    }
    for (const row of storedHistory.results) {
      if (afterHistoryKeys.has(`${row.page_id}:${row.i}`)) continue;
      statements.push(this.bindings.DB.prepare(
        "DELETE FROM history WHERE tenant = ? AND page_id = ? AND i = ?",
      ).bind(this.tenant, row.page_id, row.i));
    }
    await this.runStatements(statements);
  }
}

export function createFdeStore(tenant: string, bindings: FdeStoreBindings): FdeDataStore {
  return new FdeDataStore(tenant, bindings);
}
