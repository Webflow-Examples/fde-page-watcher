import { createHash, randomUUID } from "node:crypto";
import { signHmac } from "./crypto";
import { ProviderError, withRetry } from "./provider";
import type { IntegrationStore } from "./store";
import type { CaseDecisionRecord, CaseTransitionRecord } from "../types";
import type { TaskLinkRecord } from "./types";

/**
 * The outbound event stream for external automation.
 *
 * A signed webhook, not a workflow builder. Zapier, Make and n8n all speak
 * "receive a JSON POST and verify an HMAC", and this is that shape: one event,
 * a delivery id, a signature over the exact body. There is no expression
 * language, no field mapping and no branching here — that is the receiving
 * tool's job.
 *
 * Delivery is idempotent by event id in `integration_events`. A retried dispatch
 * finds its own row and does not send a second copy.
 *
 * V1 is outbound only (DECISIONS.md 7, and I9): an inbound webhook would need a
 * public worker or an Access bypass, and opening the app to that in this change
 * would undo the boundary it exists to keep.
 */

export const PAGE_WATCH_EVENT_HEADER = "x-pagewatch-event";
export const PAGE_WATCH_DELIVERY_HEADER = "x-pagewatch-delivery";
export const PAGE_WATCH_SIGNATURE_HEADER = "x-pagewatch-signature";

export type PageWatchEventType =
  | "page_watch.case_decided"
  | "page_watch.case_transitioned"
  | "page_watch.task_linked"
  | "page_watch.task_completed"
  | "page_watch.task_canceled";

export interface PageWatchEvent {
  event: PageWatchEventType;
  version: 1;
  id: string;
  at: string;
  projectId: string;
  data: Record<string, unknown>;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function decisionEvent(projectId: string, decision: CaseDecisionRecord): PageWatchEvent {
  const id = `decision:${digest(`${projectId}:${decision.decision}:${decision.remediationKey}:${decision.at}:${JSON.stringify(decision.by)}`)}`;
  return {
    event: "page_watch.case_decided",
    version: 1,
    id,
    at: decision.at,
    projectId,
    data: {
      decision: decision.decision,
      remediationKey: decision.remediationKey,
      ...(decision.decision === "dismiss" ? { reason: decision.reason } : {}),
      ...(decision.decision === "exclude" || decision.decision === "include" ? { pageId: decision.pageId } : {}),
      by: decision.by,
    },
  };
}

export function transitionEvent(projectId: string, transition: CaseTransitionRecord): PageWatchEvent {
  const id = `transition:${digest(`${projectId}:${transition.action}:${transition.caseKey}:${transition.at}:${JSON.stringify(transition.by)}`)}`;
  return {
    event: "page_watch.case_transitioned",
    version: 1,
    id,
    at: transition.at,
    projectId,
    data: { action: transition.action, caseKey: transition.caseKey, by: transition.by },
  };
}

export function linkEvent(projectId: string, link: TaskLinkRecord, at: string): PageWatchEvent {
  return {
    event: "page_watch.task_linked",
    version: 1,
    id: `link:${link.id}`,
    at,
    projectId,
    data: {
      provider: link.provider,
      remediationKey: link.remediationKey,
      externalId: link.externalId,
      externalUrl: link.externalUrl,
      externalState: link.externalState,
      assignee: link.assignee,
    },
  };
}

export function taskEndingEvent(projectId: string, link: TaskLinkRecord, at: string, kind: "completed" | "canceled"): PageWatchEvent {
  return {
    event: kind === "completed" ? "page_watch.task_completed" : "page_watch.task_canceled",
    version: 1,
    id: `task:${digest(`${link.id}:${kind}:${link.externalState ?? ""}`)}`,
    at,
    projectId,
    data: {
      provider: link.provider,
      remediationKey: link.remediationKey,
      externalId: link.externalId,
      externalUrl: link.externalUrl,
      externalState: link.externalState,
    },
  };
}

export interface DeliveryResult {
  delivered: boolean;
  status?: number;
  error?: string;
  skipped?: "not-configured" | "already-sent";
}

export async function deliverEvent(input: {
  url: string;
  secret: string;
  event: PageWatchEvent;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<DeliveryResult> {
  const body = JSON.stringify(input.event);
  const signature = `sha256=${signHmac(body, input.secret)}`;
  try {
    const status = await withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
      try {
        const response = await (input.fetchImpl ?? fetch)(input.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [PAGE_WATCH_EVENT_HEADER]: input.event.event,
            [PAGE_WATCH_DELIVERY_HEADER]: input.event.id,
            [PAGE_WATCH_SIGNATURE_HEADER]: signature,
          },
          body,
          signal: controller.signal,
        });
        // Drain the body so the connection is released.
        await response.text().catch(() => "");
        if (!response.ok) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "");
          throw new ProviderError(`webhook returned ${response.status}`, {
            status: response.status,
            retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
          });
        }
        return response.status;
      } finally {
        clearTimeout(timer);
      }
    }, { sleep: input.sleep, attempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 });
    return { delivered: true, status };
  } catch (error) {
    return { delivered: false, error: String(error).slice(0, 300) };
  }
}

/**
 * Send one event if a webhook is configured, once.
 *
 * The event row is recorded before delivery, so a caller that retries after a
 * transport failure does not send a second copy of an event that already
 * arrived. A failed delivery is marked with its error; the settings card shows
 * it, and the operator can resend by requesting a new event.
 */
export async function emitEvent(input: {
  store: IntegrationStore;
  projectId: string;
  event: PageWatchEvent;
  webhookUrl?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
}): Promise<DeliveryResult> {
  if (!input.webhookUrl || !input.secret) return { delivered: false, skipped: "not-configured" };
  const at = (input.now ?? new Date()).toISOString();
  const eventId = `webhook:${input.event.id}`;
  const { created } = await input.store.recordEvent({
    id: `event-${randomUUID()}`,
    projectId: input.projectId,
    provider: "page_watch",
    eventId,
    type: input.event.event,
    payloadDigest: digest(JSON.stringify(input.event)),
    receivedAt: at,
  });
  if (!created) return { delivered: false, skipped: "already-sent" };
  const result = await deliverEvent({
    url: input.webhookUrl,
    secret: input.secret,
    event: input.event,
    fetchImpl: input.fetchImpl,
    sleep: input.sleep,
  });
  await input.store.markEventProcessed(
    "page_watch",
    eventId,
    at,
    result.delivered ? `delivered:${result.status}` : `error:${result.error}`,
  );
  return result;
}

/**
 * Send one event to the project's configured receiver, if any.
 *
 * The settings read, the secret decrypt and the delivery are in this order so a
 * project with no webhook does no work and stores no event row.
 */
export async function emitProjectEvent(input: {
  store: IntegrationStore;
  projectId: string;
  event: PageWatchEvent;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
}): Promise<DeliveryResult> {
  const settings = await input.store.getSettings();
  if (!settings.webhookUrl) return { delivered: false, skipped: "not-configured" };
  const { decryptedWebhookSecret } = await import("./http");
  const secret = await decryptedWebhookSecret(settings);
  if (!secret) return { delivered: false, skipped: "not-configured" };
  return emitEvent({ ...input, webhookUrl: settings.webhookUrl, secret });
}
