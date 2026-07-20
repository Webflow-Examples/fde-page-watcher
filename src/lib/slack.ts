// Slack notifier. Posts to SLACK_WEBHOOK_URL if configured; otherwise logs and
// no-ops so the pipeline runs without a webhook.

import { getEnv } from "./env";

async function post(text: string): Promise<{ sent: boolean }> {
  const webhook = getEnv("SLACK_WEBHOOK_URL");
  if (!webhook) {
    console.log(`[slack:noop] ${text}`);
    return { sent: false };
  }
  try {
    await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    return { sent: true };
  } catch (err) {
    console.error("[slack] post failed", err);
    return { sent: false };
  }
}

/** Drop alert naming the page and affected categories (REQ-017). */
export function postAlert(pageTitle: string, url: string, categories: string[]): Promise<{ sent: boolean }> {
  return post(`⚠️ *${pageTitle}* (${url}) degraded on ${categories.join(", ")} — beyond the drop threshold on consecutive nights.`);
}

/** Follow-up report: before/after per category, labeled as correlation (REQ-041/045). */
export function postFollowup(pageTitle: string, interval: string, lines: string[]): Promise<{ sent: boolean }> {
  return post(`📈 *${pageTitle}* — ${interval} follow-up after change marker (change correlated with the marker, not proven cause):\n${lines.join("\n")}`);
}
