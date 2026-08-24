/**
 * Post-remediation verification.
 *
 * When an agent-access task is marked implemented, the provider re-runs only
 * the checks that task recorded as its verification target. The check ids come
 * from stored state, never from the request: a caller sends a task key and the
 * collector resolves what to run, so the endpoint cannot be used to execute an
 * arbitrary check set against an arbitrary origin.
 *
 * A provider that cannot answer leaves the issue verifying and retryable.
 * Silence from Ora is not evidence that a fix failed.
 */

import {
  normalizeOraTarget,
  oraCheckResult,
  OraTargetError,
} from "../src/lib/ora";
import {
  applyAgentVerificationResults,
  beginAgentVerification,
  recordAgentVerificationFailure,
  reopenReturnedAgentTask,
  verificationTargetsFor,
} from "../src/lib/agentIssueTasks";
import type { AgentIssueVerificationResult, Rec } from "../src/lib/types";
import { createFdeStore, type FdeStoreBindings } from "./dataStore";
import { runOraChecks, OraTransportError, type OraClientOptions } from "./oraClient";
import {
  emptyOraRunCounters,
  oraOperationLogEvent,
  oraRunLogEvent,
  safeOraHost,
} from "./oraTelemetry";

export type VerifyRefusal =
  | "not-consented"
  | "project-archived"
  | "task-not-found"
  | "no-verification-target"
  | "unsupported-target";

export interface AgentVerificationResult {
  ok: boolean;
  tenant: string;
  recKey?: string;
  status?: "resolved" | "returned" | "verifying";
  /** Per-check outcomes, provider-neutral. */
  results?: AgentIssueVerificationResult[];
  /** True when a returned issue was moved back into open work. */
  reopened?: boolean;
  errorCode?: string;
  refusedReason?: VerifyRefusal;
}

export interface VerifyAgentIssueOptions extends Pick<OraClientOptions, "fetchFn"> {
  now?: Date;
}

function targetOriginFor(rec: Rec): string {
  const candidate = rec.agentIssue?.origin ?? rec.url;
  return normalizeOraTarget(candidate).origin;
}

/**
 * Run the provider checks recorded on one task and fold the outcome into its
 * verification state.
 */
export async function verifyAgentIssueTask(
  env: FdeStoreBindings & { ORA_SCAN_API_KEY?: string },
  tenant: string,
  recKey: string,
  options: VerifyAgentIssueOptions = {},
): Promise<AgentVerificationResult> {
  const now = options.now ?? new Date();
  const store = createFdeStore(tenant, env);
  const state = await store.getState();
  if (state.projectArchivedAt) {
    return { ok: false, tenant, refusedReason: "project-archived" };
  }
  if (state.externalAgentAuditEnabled !== true) {
    return { ok: false, tenant, refusedReason: "not-consented" };
  }

  const rec = state.recs.find((item) => item.key === recKey && item.source === "agent-readiness");
  if (!rec) return { ok: false, tenant, refusedReason: "task-not-found" };

  // The target is resolved from stored state, so an untrusted check id can
  // never reach the provider.
  const checkIds = verificationTargetsFor(rec);
  if (checkIds.length === 0) {
    return { ok: false, tenant, recKey, refusedReason: "no-verification-target" };
  }

  let origin: string;
  try {
    origin = targetOriginFor(rec);
  } catch (error) {
    if (error instanceof OraTargetError) {
      return { ok: false, tenant, recKey, refusedReason: "unsupported-target" };
    }
    throw error;
  }

  await store.updateState((draft) => {
    const target = draft.recs.find((item) => item.key === recKey);
    if (target) beginAgentVerification(target, now);
  });

  const counters = emptyOraRunCounters();
  const host = safeOraHost(origin);
  const client: OraClientOptions = {
    ...(env.ORA_SCAN_API_KEY ? { apiKey: env.ORA_SCAN_API_KEY } : {}),
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    onOperation: (operation) => {
      console.log(oraOperationLogEvent({
        operation: operation.operation,
        tenant,
        host,
        status: operation.httpStatus < 300 ? "ok" : "provider",
        httpStatus: operation.httpStatus,
        durationMs: operation.durationMs,
        checkCount: checkIds.length,
      }));
    },
  };

  let outcome: Awaited<ReturnType<typeof runOraChecks>>;
  try {
    outcome = await runOraChecks(origin, checkIds, client);
  } catch (error) {
    const code = error instanceof OraTransportError ? "TRANSPORT" : "UNKNOWN";
    const message = error instanceof Error ? error.message : String(error);
    await store.updateState((draft) => {
      const target = draft.recs.find((item) => item.key === recKey);
      if (target) recordAgentVerificationFailure(target, { code, message }, now);
    });
    counters.verificationsUnconfirmed += 1;
    console.log(oraRunLogEvent(tenant, counters, { operation: "verify" }));
    return { ok: false, tenant, recKey, status: "verifying", errorCode: code };
  }

  if (outcome.kind !== "results") {
    const code = ("code" in outcome && outcome.code)
      || `HTTP_${"status" in outcome ? outcome.status : "429"}`;
    const message = ("message" in outcome && outcome.message) || "Provider could not re-check";
    await store.updateState((draft) => {
      const target = draft.recs.find((item) => item.key === recKey);
      if (target) recordAgentVerificationFailure(target, { code, message }, now);
    });
    if (code === "MALFORMED_CHECKS") counters.contractFailures += 1;
    counters.verificationsUnconfirmed += 1;
    console.log(oraRunLogEvent(tenant, counters, { operation: "verify" }));
    // Still verifying, and retryable: the remediation is unproven, not failed.
    return { ok: false, tenant, recKey, status: "verifying", errorCode: code };
  }

  const observedAt = now.toISOString();
  const results: AgentIssueVerificationResult[] = outcome.results.map((item) => ({
    checkId: item.id,
    result: oraCheckResult(item.status),
    observedAt,
  }));

  const commit: { status?: AgentVerificationResult["status"]; reopened?: boolean } = {};
  await store.updateState((draft) => {
    const target = draft.recs.find((item) => item.key === recKey);
    if (!target) return;
    const verification = applyAgentVerificationResults(target, results, now);
    commit.status = verification.status === "resolved" ? "resolved"
      : verification.status === "returned" ? "returned"
        : "verifying";
    // A returned issue goes back into open work so it reappears in the list.
    commit.reopened = reopenReturnedAgentTask(target);
  });

  if (commit.status === "resolved") counters.verificationsResolved += 1;
  else if (commit.status === "returned") counters.verificationsReturned += 1;
  else counters.verificationsUnconfirmed += 1;
  console.log(oraRunLogEvent(tenant, counters, { operation: "verify" }));

  return {
    ok: commit.status === "resolved",
    tenant,
    recKey,
    status: commit.status ?? "verifying",
    results,
    ...(commit.reopened ? { reopened: true } : {}),
  };
}
