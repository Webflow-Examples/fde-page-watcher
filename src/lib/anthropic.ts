import { getEnv } from "./env";

// Claude text-generation client. Mirrors slack.ts's shape: reads its key via
// getEnv, no-ops (returns null) if unconfigured, and never throws — callers
// (the nightly pipeline) must not be blocked by a missing key or a flaky call.

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

interface MessagesResponse {
  content?: { type: string; text?: string }[];
}

async function callOnce(prompt: string, system: string | undefined, maxTokens: number, signal: AbortSignal): Promise<string | null> {
  const key = getEnv("ANTHROPIC_API_KEY");
  if (!key) {
    console.log("[anthropic:noop] no ANTHROPIC_API_KEY set");
    return null;
  }
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as MessagesResponse;
  const text = json.content?.find((b) => b.type === "text")?.text;
  return text?.trim() || null;
}

function mockText(prompt: string): string {
  return `[ANTHROPIC_MOCK] ${prompt.slice(0, 100).replace(/\s+/g, " ")}…`;
}

/**
 * Generate a short piece of text with Claude. Returns null — never throws —
 * when unconfigured or when the call ultimately fails, so the nightly run
 * always completes with or without this feature configured.
 */
export async function generateText(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<string | null> {
  if (getEnv("ANTHROPIC_MOCK")) return mockText(prompt);

  const maxTokens = opts?.maxTokens ?? 300;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      return await callOnce(prompt, opts?.system, maxTokens, ctrl.signal);
    } catch (err) {
      if (attempt === 1) {
        console.error("[anthropic] generateText failed", err);
        return null;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
