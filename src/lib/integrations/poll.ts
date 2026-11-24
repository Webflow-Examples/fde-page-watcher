import type { AppState } from "../types";
import type { IntegrationStore } from "./store";
import type { IntegrationConnectionRecord } from "./types";
import type { TaskProvider } from "./provider";
import { providerForConnection } from "./server";
import { refreshTaskLink, recordTaskNote } from "./tasks";
import { emitProjectEvent, taskEndingEvent } from "./events";

/**
 * The scheduled read of linked tasks.
 *
 * V1 is outbound only: nothing tells Page Watch a task changed; this asks. It
 * runs from the nightly cron, where the app already has an authenticated,
 * project-scoped background call, and only when the "task completion offers
 * Mark fixed" automation is on — a project that has not asked for task signals
 * pays nothing.
 *
 * It never changes a case. A completion becomes a note and an offer; a
 * cancellation becomes a note and an offer to dismiss. Resolved is still the
 * checkpoints' word.
 */

export interface PollResult {
  skipped?: "automation-off" | "no-connection";
  refreshed: number;
  notes: number;
  errors: string[];
}

export async function pollProjectTasks(input: {
  projectId: string;
  store: IntegrationStore;
  state: AppState;
  now?: Date;
  fetchImpl?: typeof fetch;
  providerFactory?: (connection: IntegrationConnectionRecord) => TaskProvider;
  limit?: number;
}): Promise<PollResult> {
  const result: PollResult = { refreshed: 0, notes: 0, errors: [] };
  const settings = await input.store.getSettings();
  if (!settings.automations.taskCompletionOffersMarkFixed) {
    return { ...result, skipped: "automation-off" };
  }
  const connections = (await input.store.listConnections()).filter((connection) => connection.status === "connected");
  if (connections.length === 0) return { ...result, skipped: "no-connection" };

  const links = await input.store.listLinks();
  const limit = input.limit ?? 10;
  for (const connection of connections) {
    let provider: TaskProvider;
    try {
      provider = input.providerFactory
        ? input.providerFactory(connection)
        : providerForConnection(connection, { fetchImpl: input.fetchImpl });
    } catch (error) {
      result.errors.push(`${connection.provider}: ${String(error).slice(0, 200)}`);
      continue;
    }
    const due = links
      .filter((link) => link.provider === connection.provider)
      .sort((a, b) => (a.lastSyncedAt ?? "").localeCompare(b.lastSyncedAt ?? ""))
      .slice(0, limit);
    for (const link of due) {
      try {
        const refreshed = await refreshTaskLink({ store: input.store, provider, link, now: input.now });
        result.refreshed += 1;
        if (refreshed.note && (refreshed.completed || refreshed.canceled)) {
          const created = await recordTaskNote({
            store: input.store,
            link: refreshed.link,
            kind: refreshed.completed ? "completed" : "canceled",
            text: refreshed.note,
            now: input.now,
          });
          if (created) {
            result.notes += 1;
            await emitProjectEvent({
              store: input.store,
              projectId: input.projectId,
              event: taskEndingEvent(
                input.projectId,
                refreshed.link,
                (input.now ?? new Date()).toISOString(),
                refreshed.completed ? "completed" : "canceled",
              ),
            });
          }
        }
      } catch (error) {
        result.errors.push(`${connection.provider}/${link.externalId}: ${String(error).slice(0, 200)}`);
      }
    }
  }
  return result;
}
