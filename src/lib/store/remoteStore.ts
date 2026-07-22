import type { AppState, ChangeMarker, Night } from "../types";
import { mediansOf, pageTrend } from "../scoring";
import { resolveMarkerIndex } from "../followups";
import { getEnv } from "../env";
import type { DataStore } from "./fsStore";
import { normalizeState } from "./normalize";

interface VersionedStateResponse {
  state: AppState;
  version: number;
  updatedAt: string;
}

function baseUrl(): string {
  const configured = getEnv("FDE_DATA_URL") ?? getEnv("COLLECTOR_URL");
  if (!configured) throw new Error("Remote storage is not configured; missing: FDE_DATA_URL or COLLECTOR_URL");
  return configured.replace(/\/jobs\/?$/, "").replace(/\/$/, "");
}

function secret(): string {
  const value = getEnv("CRON_SECRET");
  if (!value) throw new Error("Remote storage is not configured; missing: CRON_SECRET");
  return value;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export class RemoteDataStore implements DataStore {
  readonly tenant: string;

  constructor(tenant: string, private readonly fetchFn: typeof fetch = fetch) {
    if (!tenant || !tenant.trim()) throw new Error("DataStore: a tenant scope is required");
    this.tenant = tenant;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${secret()}`);
    if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    return this.fetchFn(`${baseUrl()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  }

  private async versionedState(): Promise<VersionedStateResponse> {
    const response = await this.request(`/data/${segment(this.tenant)}/state`);
    if (!response.ok) throw new Error(`FDE state read ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const value = await response.json() as VersionedStateResponse;
    return { ...value, state: normalizeState(value.state) };
  }

  async getState(): Promise<AppState> {
    return structuredClone((await this.versionedState()).state);
  }

  async updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.versionedState();
      const draft = structuredClone(current.state);
      await mutate(draft);
      const response = await this.request(`/data/${segment(this.tenant)}/state`, {
        method: "PUT",
        body: JSON.stringify({ state: draft, expectedVersion: current.version }),
      });
      if (response.status === 409) continue;
      if (!response.ok) throw new Error(`FDE state write ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const value = await response.json() as VersionedStateResponse;
      return normalizeState(value.state);
    }
    throw new Error("DataStore: remote state update retry exhausted");
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
    if (commit.night && rawReport !== undefined) {
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
      if (page.markers.some((item) => item.id === input.id)) return;
      const marker: ChangeMarker = { ...input, i: resolveMarkerIndex(page.history, input.date) };
      page.markers = [...(page.markers ?? []), marker];
      mutate?.(draft, marker);
    });
  }

  private reportPath(pageId: string, key: string): string {
    return `/data/${segment(this.tenant)}/reports/${segment(pageId)}/${segment(key)}`;
  }

  async putReport(pageId: string, key: string, payload: unknown): Promise<void> {
    const response = await this.request(this.reportPath(pageId, key), {
      method: "PUT",
      body: JSON.stringify({ payload }),
    });
    if (!response.ok) throw new Error(`FDE report write ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  async getReport(pageId: string, key: string): Promise<unknown | null> {
    const response = await this.request(this.reportPath(pageId, key));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`FDE report read ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return (await response.json() as { payload: unknown }).payload;
  }

  async deleteReport(pageId: string, key: string): Promise<void> {
    const response = await this.request(this.reportPath(pageId, key), { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`FDE report delete ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }
}

export function createRemoteStore(tenant: string, fetchFn?: typeof fetch): DataStore {
  return new RemoteDataStore(tenant, fetchFn);
}
