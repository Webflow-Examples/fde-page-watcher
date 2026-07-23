import type { AgentCheck } from "./types";

export interface AgentCheckGroup {
  name: string;
  items: string[];
}

/** The canonical 20 agent-readiness checks, grouped as they appear in the UI. */
export const AGENT_CHECK_GROUPS: AgentCheckGroup[] = [
  { name: "Discoverability", items: ["robots.txt", "Sitemap", "Link headers", "DNS for AI Discovery (DNS-AID)"] },
  { name: "Content Accessibility", items: ["Markdown negotiation"] },
  { name: "Bot Access Control", items: ["AI bot rules", "Content Signals", "Web Bot Auth"] },
  { name: "API / Auth / MCP", items: ["API Catalog", "OAuth discovery", "OAuth Protected Resource", "Auth.md", "MCP Server Card", "A2A Agent Card", "Agent Skills", "WebMCP"] },
  { name: "Commerce", items: ["x402", "MPP", "UCP", "ACP"] },
];

export const ALL_AGENT_CHECKS: Pick<AgentCheck, "group" | "name">[] = AGENT_CHECK_GROUPS.flatMap((group) =>
  group.items.map((name) => ({ group: group.name, name })),
);

export function isKnownAgentIgnoreTarget(scope: "check" | "group", value: string): boolean {
  return scope === "group"
    ? AGENT_CHECK_GROUPS.some((group) => group.name === value)
    : ALL_AGENT_CHECKS.some((check) => `${check.group}\u001f${check.name}` === value);
}
