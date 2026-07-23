import type { AgentCheck } from "./types";
import { AGENT_CHECK_GROUPS } from "./agentChecks";
import { normalizeUrl } from "./psiCore";

// Real, dependency-free agent-readiness scan. Each check is recorded pass/fail
// (REQ-008); if the page is unreachable the whole scan is marked unavailable
// (REQ-033). Emerging standards with no HTTP-observable signal record as fail
// with a note. Swappable for the Cloudflare URL Scanner / isitagentready MCP.

async function probe(u: string, opts: RequestInit = {}, timeoutMs = 8000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(u, { ...opts, signal: ctrl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const AI_UAS = /gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic|ccbot|google-extended|perplexitybot|bytespider|amazonbot/i;

export async function scan(url: string): Promise<AgentCheck[]> {
  const full = normalizeUrl(url);
  const origin = (() => {
    try {
      return new URL(full).origin;
    } catch {
      return full;
    }
  })();

  const base = await probe(full);
  if (!base) {
    // Unreachable → every check unavailable, not failing.
    return AGENT_CHECK_GROUPS.flatMap((g) => g.items.map((name) => ({ name, group: g.name, pass: false, unavailable: true, detail: "page unreachable" })));
  }

  const robotsRes = await probe(`${origin}/robots.txt`);
  const robotsOk = !!robotsRes?.ok;
  const robots = robotsOk ? (await robotsRes!.text().catch(() => "")).toLowerCase() : "";
  const linkHeader = base.headers.get("link");
  const md = await probe(full, { headers: { Accept: "text/markdown" } });
  const mdOk = !!md && (md.headers.get("content-type") ?? "").includes("markdown");

  const wk = async (path: string) => !!(await probe(`${origin}${path}`))?.ok;
  const [apiCatalog, oauthAS, oauthPR, authMd, mcpCard, a2aCard, agentSkills] = await Promise.all([
    wk("/.well-known/api-catalog"),
    wk("/.well-known/oauth-authorization-server"),
    wk("/.well-known/oauth-protected-resource"),
    wk("/.well-known/auth.md"),
    wk("/.well-known/mcp.json"),
    wk("/.well-known/agent.json"),
    wk("/.well-known/agent-skills.json"),
  ]);

  const results: Record<string, { pass: boolean; detail?: string }> = {
    "robots.txt": { pass: robotsOk },
    Sitemap: { pass: /sitemap:/i.test(robots) || (await wk("/sitemap.xml")) },
    "Link headers": { pass: !!linkHeader },
    "DNS for AI Discovery (DNS-AID)": { pass: false, detail: "no DNS-AID record observable over HTTP" },
    "Markdown negotiation": { pass: mdOk, detail: mdOk ? undefined : "no text/markdown representation" },
    "AI bot rules": { pass: AI_UAS.test(robots), detail: AI_UAS.test(robots) ? undefined : "no AI user-agent rules in robots.txt" },
    "Content Signals": { pass: /content-signal|content-usage/i.test(robots) },
    "Web Bot Auth": { pass: !!base.headers.get("signature-agent") },
    "API Catalog": { pass: apiCatalog },
    "OAuth discovery": { pass: oauthAS },
    "OAuth Protected Resource": { pass: oauthPR },
    "Auth.md": { pass: authMd },
    "MCP Server Card": { pass: mcpCard },
    "A2A Agent Card": { pass: a2aCard },
    "Agent Skills": { pass: agentSkills },
    WebMCP: { pass: false, detail: "no WebMCP interface advertised" },
    x402: { pass: base.status === 402 },
    MPP: { pass: false },
    UCP: { pass: false },
    ACP: { pass: false },
  };

  return AGENT_CHECK_GROUPS.flatMap((g) =>
    g.items.map((name) => ({ name, group: g.name, pass: results[name]?.pass ?? false, detail: results[name]?.detail })),
  );
}
