import {
  buildWeeklyDataAuditFromInspections,
  inspectStoredAuditCapture,
} from "../src/lib/dataAudit";
import type { InspectedStoredAuditCapture, WeeklyDataAudit } from "../src/lib/dataAudit";
import { isPageActivelyMonitored } from "../src/lib/watchCapacity";
import { nightHasStrategy } from "../src/lib/scoring";
import { STRATEGIES } from "../src/lib/types";
import type { Night } from "../src/lib/types";
import { createFdeStore, type FdeStoreBindings } from "./dataStore";

export const WEEKLY_AUDIT_CRON = "30 5 * * 1";
export const WEEKLY_AUDIT_LATEST_KEY = "audits/weekly/latest.json";
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

export interface WeeklyAuditEnvironment extends FdeStoreBindings {
  NIGHTLY_TENANT: string;
}

export function tenantWeeklyAuditLatestKey(tenant: string): string {
  return `${tenant}/${WEEKLY_AUDIT_LATEST_KEY}`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function storedPayload(
  env: WeeklyAuditEnvironment,
  tenant: string,
  pageId: string,
  rawReportKey: string | undefined,
): Promise<unknown | null> {
  if (!rawReportKey) return null;
  const object = await env.REPORTS.get(`${tenant}/${pageId}/${rawReportKey}.json`);
  if (!object) return null;
  try {
    const envelope = objectRecord(await object.json<unknown>());
    if (envelope?.tenant !== tenant || !("payload" in (envelope ?? {}))) {
      return { invalidReportEnvelope: true };
    }
    return envelope.payload;
  } catch {
    return { invalidReportJson: true };
  }
}

async function storedReport(
  env: WeeklyAuditEnvironment,
  tenant: string,
  pageId: string,
  night: Night,
): Promise<unknown | null> {
  const combined = await storedPayload(env, tenant, pageId, night.rawReportKey);
  if (combined !== null) return combined;

  const strategyEntries = await Promise.all(STRATEGIES
    .filter((strategy) => nightHasStrategy(night, strategy))
    .map(async (strategy) => {
      const report = await storedPayload(env, tenant, pageId, night.strategyReportKeys?.[strategy]);
      return report === null ? null : [strategy, report] as const;
    }));
  const strategies = Object.fromEntries(strategyEntries.filter((entry) => entry !== null));
  return Object.keys(strategies).length > 0 ? { strategies } : null;
}

/** Inspect one large raw report at a time so weekly verification stays memory-bounded. */
export async function runWeeklyDataAudit(
  env: WeeklyAuditEnvironment,
  scheduledAt = new Date(),
  options: { tenant?: string } = {},
): Promise<WeeklyDataAudit> {
  const tenant = options.tenant ?? (env.NIGHTLY_TENANT || "brand-studio:live");
  const periodEnd = new Date(scheduledAt);
  const periodStart = new Date(periodEnd.getTime() - WEEK_MS);
  const store = createFdeStore(tenant, env);
  const state = await store.getState();
  const inspections: InspectedStoredAuditCapture[] = [];

  for (const page of state.pages) {
    for (const night of page.history) {
      const capturedAt = night.iso ? Date.parse(night.iso) : Number.NaN;
      if (!Number.isFinite(capturedAt) || capturedAt < periodStart.getTime() || capturedAt >= periodEnd.getTime()) continue;
      const report = await storedReport(env, tenant, page.id, night);
      inspections.push(inspectStoredAuditCapture({ pageId: page.id, night, report }));
    }
  }

  const audit = await buildWeeklyDataAuditFromInspections({
    tenant,
    generatedAt: new Date().toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    monitoredPageIds: state.pages.filter(isPageActivelyMonitored).map((page) => page.id),
    inspections,
    jobs: state.jobs ?? [],
  });
  const body = JSON.stringify(audit);
  const datedKey = `${tenant}/audits/weekly/${audit.periodEnd.slice(0, 10)}.json`;
  await Promise.all([
    env.REPORTS.put(datedKey, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { auditId: audit.auditId, health: audit.health },
    }),
    env.REPORTS.put(tenantWeeklyAuditLatestKey(tenant), body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { auditId: audit.auditId, health: audit.health },
    }),
  ]);
  return audit;
}
