import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  it.each(PROTECTED_MODULES)("%s does not read external provider evidence", (module) => {
    const text = source(module);
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

  it("does not schedule or trigger any scan in Phase 1", () => {
    const collector = source("collector-worker/ora.ts");
    expect(collector).not.toMatch(/\bfetch\s*\(/);
    expect(collector).not.toContain("ORA_SCAN_ENABLED");
    expect(collector).not.toContain("cron");
    // The worker's triggers are unchanged: no new scheduled job was added.
    const wrangler = source("collector-worker/wrangler.jsonc");
    expect(wrangler).not.toContain("ora");
    expect(wrangler).not.toContain("ORA_");
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

  it("adds no user-facing score surface yet", () => {
    const appFiles = [
      ...walk(path.join(ROOT, "src", "app")),
      ...walk(path.join(ROOT, "src", "components")),
    ];
    const referencing = appFiles.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /agentAudit|ExternalAgentAudit|getExternalAgentAudits/.test(text);
    });
    expect(referencing).toEqual([]);
  });
});

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}
