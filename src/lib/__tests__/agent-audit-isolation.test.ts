import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExternalAgentCheckResult } from "../agentAudit";
import type { AgentIssueCheckResult } from "../types";

/**
 * Structural guard for the Phase 1 boundary: external provider evidence must
 * stay out of the local agent scan, the frozen readiness snapshot, Kitesurf,
 * Lighthouse, CrUX, page status, and collection completion.
 *
 * Import-graph assertions are the enforceable form of that rule — if a later
 * change wires provider data into any of those paths, one of these fails.
 */

const ROOT = path.join(__dirname, "..", "..", "..");

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function importedModules(relativePath: string): string[] {
  return [...source(relativePath).matchAll(/(?:^|\n)\s*import[^;]*?from\s*["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

/** Modules that decide local agent readiness, page status, or run completion. */
const PROTECTED_MODULES = [
  "src/lib/agentReadiness.ts",
  "src/lib/agentChecks.ts",
  "src/lib/agentScoring.ts",
  "src/lib/agentHistory.ts",
  "src/lib/scoring.ts",
  "src/lib/types.ts",
  "src/lib/crux.ts",
  "src/lib/kitesurfEvidence.ts",
  "src/lib/lighthouseEvidence.ts",
  "src/lib/collectionStatus.ts",
  "src/lib/dashboardVerdict.ts",
  "src/lib/performanceIssues.ts",
  "src/lib/scoreCard.ts",
  "src/lib/dataAudit.ts",
  "collector-worker/index.ts",
  "collector-worker/nightly.ts",
  "collector-worker/kitesurf.ts",
  "collector-worker/crux.ts",
  "collector-worker/weeklyAudit.ts",
];

describe("external agent audit isolation", () => {
  it.each(PROTECTED_MODULES)("%s does not read external provider evidence", (modulePath) => {
    const text = source(modulePath);
    expect(text).not.toMatch(/from\s+["'][^"']*agentAudit["']/);
    expect(text).not.toMatch(/from\s+["'][^"']*\/ora["']/);
    expect(text).not.toMatch(/from\s+["']\.\/ora["']/);
    expect(text).not.toContain("ExternalAgentAudit");
    expect(text).not.toContain("agent_audit_snapshots");
  });

  it("keeps the provider-neutral types free of any dependency", () => {
    // No imports at all: the type module cannot pull in scoring or state logic.
    expect(importedModules("src/lib/agentAudit.ts")).toEqual([]);
  });

  it("keeps the Ora parser pure and narrowly coupled", () => {
    // Only the shared private-address policy and its own types.
    expect(importedModules("src/lib/ora.ts").sort()).toEqual(["./agentAudit", "./pageTitle"]);
    const text = source("src/lib/ora.ts");
    // A pure module: no network, no storage, no scheduling.
    expect(text).not.toMatch(/\bfetch\s*\(/);
    expect(text).not.toContain("setTimeout");
    expect(text).not.toContain("D1Database");
    expect(text).not.toContain("R2Bucket");
  });

  it("keeps the audit store free of network access", () => {
    const collector = source("collector-worker/ora.ts");
    expect(collector).not.toMatch(/\bfetch\s*\(/);
    expect(collector).not.toContain("ORA_SCAN_ENABLED");
  });

  it("keeps the scheduled refresh out of the collection workflow", () => {
    // The collection path must never reach the external client or orchestrator,
    // so a provider problem cannot delay or fail a Page Watch collection.
    for (const modulePath of [
      "collector-worker/nightly.ts",
      "collector-worker/crux.ts",
      "collector-worker/kitesurf.ts",
      "collector-worker/weeklyAudit.ts",
    ]) {
      const text = source(modulePath);
      expect(text).not.toContain("oraRefresh");
      expect(text).not.toContain("oraClient");
      expect(text).not.toContain("oraSchedule");
      expect(text).not.toContain("refreshExternalAgentAudits");
    }
    // The worker dispatches the external refresh on its own cron and returns
    // before the shared collection scheduler machinery is entered.
    const index = source("collector-worker/index.ts");
    const branch = index.indexOf("controller.cron === ORA_REFRESH_CRON");
    const sharedKind = index.indexOf("const kind = controller.cron === WEEKLY_AUDIT_CRON");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(sharedKind);
    expect(index).not.toContain("runNightlyAcrossProjects(env, tenants, { scheduled: true, ora");
  });

  it("ships the deployment gate closed on its own cron", () => {
    const wrangler = source("collector-worker/wrangler.jsonc");
    const crons = [...wrangler.matchAll(/"\s*[\d*]+[^"]*\*[^"]*"/g)].map((match) => match[0]);
    // Three pre-existing collection crons plus one dedicated external refresh.
    expect(crons).toHaveLength(4);
    expect(crons.at(-1)).toContain("45 6 * * 3");
    expect(wrangler).toContain('"ORA_SCAN_ENABLED": "false"');
  });

  it("never lets a caller choose which provider checks are re-run", () => {
    const verify = source("collector-worker/oraVerify.ts");
    // Targets come from stored state only.
    expect(verify).toContain("verificationTargetsFor(rec)");
    const dataPlane = source("collector-worker/dataPlane.ts");
    const verifyBlock = dataPlane.slice(
      dataPlane.indexOf('matched.kind === "agent-audits-verify"'),
      dataPlane.indexOf('matched.kind === "agent-audits-refresh"'),
    );
    expect(verifyBlock).toContain("recKey");
    expect(verifyBlock).not.toContain("checkIds");
  });

  it("checks project consent before resolving any target", () => {
    const refresh = source("collector-worker/oraRefresh.ts");
    const consentAt = refresh.indexOf("externalAgentAuditEnabled !== true");
    const firstTarget = refresh.indexOf("normalizeOraTarget(page.url)");
    expect(consentAt).toBeGreaterThan(-1);
    expect(firstTarget).toBeGreaterThan(-1);
    // A project that has not opted in cannot reach target resolution at all.
    expect(consentAt).toBeLessThan(firstTarget);
  });

  it("only reaches storage through the new tables", () => {
    const migration = source("migrations/0007_agent_audits.sql");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS agent_audit_snapshots/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS agent_audit_status/);
    // Additive only: no existing table or column is altered or dropped.
    expect(migration).not.toMatch(/\b(ALTER|DROP)\b/i);
    for (const table of ["state", "history", "markers", "crux_snapshots", "crux_status", "collection_jobs"]) {
      expect(migration).not.toMatch(new RegExp(`\\b(INTO|FROM|TABLE)\\s+${table}\\b`, "i"));
    }
  });

  it("exposes external evidence only through its own read-only route", () => {
    const dataPlane = source("collector-worker/dataPlane.ts");
    expect(dataPlane).toContain("getExternalAgentAudits");
    // No refresh or verify endpoint yet.
    expect(dataPlane).not.toContain("agent-audits/ora/refresh");
    expect(dataPlane).not.toContain("agent-audits/ora/verify");
  });

  it("shows the Page Watch verdict on the dashboard, never a provider score", () => {
    const dashboard = source("src/app/(app)/dashboard/page.tsx");
    // The verdict is a Page Watch conclusion and belongs here.
    expect(dashboard).toContain("agentAccessSummary");
    // Provider numbers stay on the page's own evidence surface.
    for (const forbidden of [
      "essentialsScore",
      "providerScore",
      "providerGrade",
      "externalAgentSourceReading",
      "ExternalAgentAuditPanel",
      "reportUrl",
    ]) {
      expect(dashboard, `dashboard must not surface ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never composites a provider score with the local check percentage", () => {
    for (const modulePath of ["src/lib/externalAgentEvidence.ts", "src/components/agent-audit.tsx"]) {
      const text = source(modulePath);
      // The local readiness percentage is computed by agentScoring; the
      // external presentation layer must not read it at all.
      expect(text).not.toContain("agentScoring");
      expect(text).not.toContain("summarizeAgentChecks");
      expect(text).not.toContain("agentReadiness");
    }
  });

  it("keeps the duplicated result union in step with the provider one", () => {
    // AppState must not import provider modules, so AgentIssueCheckResult is a
    // deliberate copy. These two assignments only compile while the unions are
    // identical in both directions.
    const fromProvider: AgentIssueCheckResult = "partial" as ExternalAgentCheckResult;
    const toProvider: ExternalAgentCheckResult = "partial" as AgentIssueCheckResult;
    expect(fromProvider).toBe("partial");
    expect(toProvider).toBe("partial");
  });

  it("keeps provider evidence out of AppState", () => {
    // AppState carries the consent record only. Provider readings travel beside
    // the state so they cannot be written back through a state mutation.
    const types = source("src/lib/types.ts");
    expect(types).toContain("externalAgentAuditEnabled");
    // Verification identifiers are allowed on a task; provider evidence
    // payloads are not.
    expect(types).not.toContain("ExternalAgentAuditSnapshot");
    expect(types).not.toContain("ExternalAgentOriginAudit");
    expect(types).not.toContain("ExternalAgentFinding");
    expect(importedModules("src/lib/types.ts")).toEqual([]);
    const normalize = source("src/lib/store/normalize.ts");
    expect(normalize).not.toContain("ExternalAgentAudit");
  });
});
