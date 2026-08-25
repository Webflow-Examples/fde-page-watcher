import type { Digest } from "./digest";
import { renderDigestMessage } from "./digest-email";

export interface WebhookDelivery {
  sent: boolean;
  status?: number;
  error?: string;
  retryAfterSeconds?: number;
}

/**
 * The digest, as a machine reads it.
 *
 * A transport for the one digest rather than a second digest. Before S7 this
 * built its own summary from a list of regressing pages, which meant the product
 * had two descriptions of the same night that nothing kept in step — and the
 * webhook's was written in the page-status vocabulary F2 retired. Now the
 * sections, the sentences and the links are the ones in the message, so a
 * reworded line cannot reach one reader and not the other.
 *
 * Version 2 because the shape changed. A consumer parsing version 1 is parsing a
 * summary that no longer exists, and silently reshaping a payload under the same
 * version number is the drift the registry's own version rule exists to stop.
 */
export interface DigestWebhookLine {
  text: string;
  href: string;
  /** Absent when the line is not about one case — the Held count, an unread page. */
  caseId?: string;
}

export interface DigestWebhookSection {
  kind: string;
  heading: string;
  lines: DigestWebhookLine[];
}

export interface DailyDigestWebhookPayload {
  event: "page_watch.daily_digest";
  version: 2;
  id: string;
  date: string;
  site: string;
  /** The verdict. The same string the message's subject carries. */
  subject: string;
  /** The whole message, as text. */
  text: string;
  /** Non-empty sections only, in the digest's fixed order. */
  sections: DigestWebhookSection[];
}

const MAX_WEBHOOK_URL_LENGTH = 2_048;
const MAX_DIAGNOSTIC_LENGTH = 500;
const WEBHOOK_TIMEOUT_MS = 10_000;

export function alertWebhookUrlIsValid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_WEBHOOK_URL_LENGTH) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:"
      && !!url.hostname
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function normalizeAlertWebhookUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return alertWebhookUrlIsValid(trimmed) ? trimmed : null;
}

export function buildDailyDigestWebhookPayload(
  digest: Digest,
  cohortId: string,
): DailyDigestWebhookPayload {
  return {
    event: "page_watch.daily_digest",
    version: 2,
    id: cohortId,
    date: digest.date,
    site: digest.site,
    subject: digest.subject,
    text: renderDigestMessage(digest).text,
    sections: digest.sections.map((section) => ({
      kind: section.kind,
      heading: section.heading,
      lines: section.lines.map((line) => ({
        text: line.text,
        href: line.href,
        ...(line.caseId ? { caseId: line.caseId } : {}),
      })),
    })),
  };
}

function diagnostic(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

export async function postWebhook(
  webhookUrl: string | null | undefined,
  payload: DailyDigestWebhookPayload,
): Promise<WebhookDelivery> {
  const url = normalizeAlertWebhookUrl(webhookUrl);
  if (!url) return { sent: false, error: "Alert webhook URL is not configured" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": payload.id,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (response.ok) return { sent: true, status: response.status };
    const result = {
      sent: false,
      status: response.status,
      error: diagnostic(`${response.status} ${response.statusText}`.trim()),
      retryAfterSeconds: retryAfterSeconds(response),
    };
    console.error("[webhook] delivery rejected", result);
    return result;
  } catch (error) {
    console.error("[webhook] delivery failed", diagnostic(error));
    return { sent: false, error: diagnostic(error) };
  }
}
