import type { Strategy } from "./types";

export interface WebhookDelivery {
  sent: boolean;
  status?: number;
  error?: string;
  retryAfterSeconds?: number;
}

export interface DigestWebhookPage {
  title: string;
  url: string;
  status: "regressing";
  categories: string[];
  devices: Strategy[];
}

export interface DailyDigestWebhookPayload {
  event: "page_watch.daily_digest";
  version: 1;
  id: string;
  date: string;
  title: string;
  summary: string;
  text: string;
  pages: DigestWebhookPage[];
}

const MAX_WEBHOOK_URL_LENGTH = 2_048;
const MAX_DIAGNOSTIC_LENGTH = 500;
const WEBHOOK_TIMEOUT_MS = 10_000;

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

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
  pages: DigestWebhookPage[],
  cohortId: string,
): DailyDigestWebhookPayload {
  const count = pages.length;
  const date = cohortId.startsWith("nightly:") ? cohortId.slice("nightly:".length) : cohortId;
  const title = `Page Watch daily digest: ${count} ${plural(count, "page")} need${count === 1 ? "s" : ""} attention`;
  const summary = `${count} monitored ${plural(count, "page")} ${count === 1 ? "has" : "have"} confirmed regressions.`;
  const pageList = pages.map((page) => {
    const categories = page.categories.map(singleLine).join(", ");
    const devices = page.devices.join(", ");
    return `- ${singleLine(page.title)} — Regressing — ${categories} — ${devices}`;
  }).join("\n");
  return {
    event: "page_watch.daily_digest",
    version: 1,
    id: cohortId,
    date,
    title,
    summary,
    text: pageList || "No monitored pages need attention.",
    pages,
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
