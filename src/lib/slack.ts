// Slack notifier. Posts to SLACK_WEBHOOK_URL if configured; otherwise logs and
// no-ops so the pipeline runs without a webhook.

import { getEnv } from "./env";

export interface SlackDelivery {
  sent: boolean;
  status?: number;
  error?: string;
  retryAfterSeconds?: number;
}

const MAX_DIAGNOSTIC_LENGTH = 500;

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

async function post(text: string): Promise<SlackDelivery> {
  const webhook = getEnv("SLACK_WEBHOOK_URL");
  if (!webhook) {
    console.log(`[slack:noop] ${text}`);
    return { sent: false, error: "SLACK_WEBHOOK_URL is not configured" };
  }
  try {
    const response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (response.ok) return { sent: true, status: response.status };
    const body = await response.text().catch(() => "");
    const error = diagnostic(body.trim() || `${response.status} ${response.statusText}`);
    const result = { sent: false, status: response.status, error, retryAfterSeconds: retryAfterSeconds(response) };
    console.error("[slack] webhook rejected delivery", result);
    return result;
  } catch (err) {
    console.error("[slack] post failed", err);
    return { sent: false, error: diagnostic(err) };
  }
}

/** Drop alert naming the page and affected categories (REQ-017). */
export function postAlert(pageTitle: string, url: string, categories: string[]): Promise<SlackDelivery> {
  return post(`⚠️ *${pageTitle}* (${url}) regressed on ${categories.join(", ")} — beyond the drop threshold on consecutive nights.`);
}

/** Follow-up report: before/after per category, labeled as correlation (REQ-041/045). */
export function postFollowup(pageTitle: string, interval: string, lines: string[]): Promise<SlackDelivery> {
  return post(`📈 *${pageTitle}* — ${interval} follow-up after change marker (change correlated with the marker, not proven cause):\n${lines.join("\n")}`);
}
