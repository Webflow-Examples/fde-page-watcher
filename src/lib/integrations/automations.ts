import { createHash } from "node:crypto";
import type { CaseDecisionRecord, CaseTransitionRecord } from "../types";
import type { AppState } from "../types";
import type { IntegrationStore } from "./store";
import type { IntegrationConnectionRecord, TaskLinkRecord } from "./types";
import type { TaskProvider } from "./provider";
import { createTaskForCase, unlinkTask } from "./tasks";
import { remediationKey as remediationKeyOf } from "../issue-case";
import { issueCasesFrom } from "../issue-cases";

/**
 * The four named automations, dispatched after the append-only log write.
 *
 * They live on the route, not in the mutation, on purpose: the mutation writes
 * the log and nothing else, and an external call inside an AppState
 * compare-and-swap would hold the write open for a network round trip. The
 * route records the decision first, then asks this module to act on it — so a
 * provider outage can never cost a person their decision.
 *
 * Every action is guarded by an `integration_events` row whose id is derived
 * from the decision's own stamp. Running the same dispatch twice is a no-op.
 */

export interface AutomationDeps {
  projectId: string;
  store: IntegrationStore;
  state: AppState;
  now?: Date;
  appUrl?: string;
  providerFactory?: (connection: IntegrationConnectionRecord) => TaskProvider;
}

export interface AutomationRun {
  automation: "acceptCreatesTask" | "dismissClosesTask" | "reopenCommentsAndReopens";
  outcome: "ran" | "skipped" | "failed" | "already_ran";
  detail?: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function callerKey(by: unknown): string {
  if (!by || typeof by !== "object") return "unknown";
  const value = by as { userId?: string; agent?: string };
  return value.userId ?? value.agent ?? "unknown";
}

function linksForRemediation(links: readonly TaskLinkRecord[], key: string): TaskLinkRecord[] {
  return links.filter((link) => link.remediationKey === key);
}

async function providerFor(deps: AutomationDeps, connection: IntegrationConnectionRecord): Promise<TaskProvider> {
  if (deps.providerFactory) return deps.providerFactory(connection);
  const { providerForConnection } = await import("./server");
  return providerForConnection(connection);
}

async function runOnce(
  deps: AutomationDeps,
  input: { automation: string; fact: string; provider: string; type: string; run: () => Promise<string> },
): Promise<AutomationRun> {
  const at = (deps.now ?? new Date()).toISOString();
  const eventId = `automation:${input.automation}:${input.fact}`;
  const { created } = await deps.store.recordEvent({
    id: `event-${digest(eventId)}`,
    projectId: deps.projectId,
    provider: input.provider,
    eventId,
    type: input.type,
    payloadDigest: digest(input.fact),
    receivedAt: at,
  });
  if (!created) return { automation: input.automation as AutomationRun["automation"], outcome: "already_ran" };
  try {
    const detail = await input.run();
    await deps.store.markEventProcessed(input.provider, eventId, at, detail);
    return { automation: input.automation as AutomationRun["automation"], outcome: "ran", detail };
  } catch (error) {
    await deps.store.markEventProcessed(input.provider, eventId, at, `error: ${String(error).slice(0, 300)}`);
    return { automation: input.automation as AutomationRun["automation"], outcome: "failed", detail: String(error).slice(0, 300) };
  }
}

/**
 * Accept creates a task; dismiss closes it with the dismissal reason.
 *
 * Both key on the remediation. Accept is a decision about the remediation, so
 * every case sharing it gets the one task; dismiss is the same, so every link
 * of that remediation is closed once.
 */
export async function afterDecision(deps: AutomationDeps & { decision: CaseDecisionRecord }): Promise<AutomationRun[]> {
  const { decision } = deps;
  const settings = await deps.store.getSettings();
  const runs: AutomationRun[] = [];
  const fact = `${decision.decision}:${decision.remediationKey}:${decision.at}:${callerKey(decision.by)}`;
  const connections = await deps.store.listConnections();
  const connection = connections.find((candidate) => candidate.status !== "disconnected");

  if (decision.decision === "accept" && settings.automations.acceptCreatesTask) {
    if (!connection) {
      runs.push({ automation: "acceptCreatesTask", outcome: "skipped", detail: "no task tool is connected" });
    } else {
      const issue = issueCasesFrom(deps.state).find((candidate) => remediationKeyOf(candidate) === decision.remediationKey);
      if (!issue || issue.remediation.steps.length === 0) {
        runs.push({ automation: "acceptCreatesTask", outcome: "skipped", detail: "the case has no plan" });
      } else {
        runs.push(await runOnce(deps, {
          automation: "acceptCreatesTask",
          fact,
          provider: connection.provider,
          type: "automation.accept.create_task",
          run: async () => {
            const provider = await providerFor(deps, connection);
            const outcome = await createTaskForCase({
              projectId: deps.projectId,
              state: deps.state,
              store: deps.store,
              provider,
              connection,
              remediationKey: decision.remediationKey,
              createdBy: callerKey(decision.by),
              appUrl: deps.appUrl,
              now: deps.now,
            });
            return outcome.status === "created" ? `created ${outcome.link.externalId}` : outcome.status;
          },
        }));
      }
    }
  }

  if (decision.decision === "dismiss" && settings.automations.dismissClosesTask) {
    if (connections.length === 0) {
      runs.push({ automation: "dismissClosesTask", outcome: "skipped", detail: "no task tool is connected" });
    } else {
      const allLinks = await deps.store.listLinks();
      let acted = false;
      // Both providers can be connected. Close every link of this remediation,
      // once per provider — the event id names the provider so one run cannot
      // suppress the other.
      for (const candidate of connections) {
        const links = linksForRemediation(allLinks, decision.remediationKey)
          .filter((link) => link.provider === candidate.provider);
        if (links.length === 0) continue;
        acted = true;
        runs.push(await runOnce(deps, {
          automation: "dismissClosesTask",
          fact: `${fact}:${candidate.provider}`,
          provider: candidate.provider,
          type: "automation.dismiss.close_task",
          run: async () => {
            const provider = await providerFor(deps, candidate);
            for (const link of links) {
              const task = await provider.close(link.externalId, decision.reason ?? "Dismissed in Page Watch");
              await deps.store.updateLink({
                ...link,
                externalState: task.state,
                lastSyncedAt: (deps.now ?? new Date()).toISOString(),
                updatedAt: (deps.now ?? new Date()).toISOString(),
              });
            }
            return `closed ${links.length}`;
          },
        }));
      }
      if (!acted) runs.push({ automation: "dismissClosesTask", outcome: "skipped", detail: "no linked task" });
    }
  }

  return runs;
}

/**
 * Reopen comments on the task and reopens it.
 *
 * The transition is recorded against the case's cause, but a reopen means the
 * problem came back — so the work is about the remediation, and every link for
 * that remediation is reopened.
 */
export async function afterTransition(
  deps: AutomationDeps & { transition: CaseTransitionRecord },
): Promise<AutomationRun[]> {
  const { transition } = deps;
  const settings = await deps.store.getSettings();
  if (transition.action !== "reopen" || !settings.automations.reopenCommentsAndReopens) return [];

  const issue = issueCasesFrom(deps.state).find((candidate) => candidate.cause === transition.caseKey);
  if (!issue) return [{ automation: "reopenCommentsAndReopens", outcome: "skipped", detail: "the case is no longer on the board" }];
  const key = remediationKeyOf(issue);
  const connections = (await deps.store.listConnections()).filter((candidate) => candidate.status !== "disconnected");
  if (connections.length === 0) return [{ automation: "reopenCommentsAndReopens", outcome: "skipped", detail: "no task tool is connected" }];
  const allLinks = await deps.store.listLinks();
  const fact = `${transition.action}:${transition.caseKey}:${transition.at}:${callerKey(transition.by)}`;
  const runs: AutomationRun[] = [];
  for (const connection of connections) {
    const links = linksForRemediation(allLinks, key).filter((link) => link.provider === connection.provider);
    if (links.length === 0) continue;
    runs.push(await runOnce(deps, {
      automation: "reopenCommentsAndReopens",
      fact: `${fact}:${connection.provider}`,
      provider: connection.provider,
      type: "automation.reopen.reopen_task",
      run: async () => {
        const provider = await providerFor(deps, connection);
        for (const link of links) {
          await provider.comment(link.externalId, "Reopened in Page Watch — the problem was found again. The 2/7/30-day checks will confirm it once fixed.");
          const task = await provider.reopen(link.externalId);
          await deps.store.updateLink({
            ...link,
            externalState: task.state,
            lastSyncedAt: (deps.now ?? new Date()).toISOString(),
            updatedAt: (deps.now ?? new Date()).toISOString(),
          });
        }
        return `reopened ${links.length}`;
      },
    }));
  }
  return runs.length > 0 ? runs : [{ automation: "reopenCommentsAndReopens", outcome: "skipped", detail: "no linked task" }];
}

/** Exposed for the dismiss route's manual close, which is not an automation. */
export async function closeLinkedTasksFor(
  deps: AutomationDeps,
  key: string,
  reason: string,
): Promise<void> {
  const connections = await deps.store.listConnections();
  const connection = connections.find((candidate) => candidate.status !== "disconnected");
  if (!connection) return;
  const provider = await providerFor(deps, connection);
  const links = linksForRemediation(await deps.store.listLinks(), key).filter((link) => link.provider === connection.provider);
  for (const link of links) {
    await provider.close(link.externalId, reason);
    await deps.store.deleteLink(link.provider, link.remediationKey);
  }
}

export { unlinkTask };
