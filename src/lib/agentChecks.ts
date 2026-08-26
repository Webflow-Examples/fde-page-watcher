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

/**
 * What each check is called on screen: plain meaning first, standard name after
 * it in parentheses.
 *
 * A separate map rather than a rename, because the names above are KEYS. An
 * exclusion is stored as `${group}${name}`, the scanner's result record is
 * keyed by check name, and `AGENT_ISSUE_FAMILIES.localChecks` refers to checks
 * by name. Renaming them would silently strand every exclusion a site has
 * already recorded — a migration, not a copy change, and not one this chunk
 * needs in order to fix the words.
 *
 * "DNS for AI Discovery (DNS-AID)" was already written this way, and it is the
 * shape the rest now follow. Where a name is already the plain thing —
 * `robots.txt` is a file the reader owns, a sitemap is a sitemap — it stands
 * alone; an appositive on a word that needs none is noise.
 *
 * The commerce four are acronyms with nothing else to go on, and they are
 * exactly the case for this pattern: "x402" tells a reader nothing, and "Pay
 * per request (x402)" tells them whether they care.
 */
export const AGENT_CHECK_LABEL: Readonly<Record<string, string>> = {
  "Link headers": "Related-page pointers (Link headers)",
  "Markdown negotiation": "A plain-text version on request (Markdown negotiation)",
  "Content Signals": "What may be reused, and how (Content Signals)",
  "Web Bot Auth": "Agents that can prove who they are (Web Bot Auth)",
  "API Catalog": "A directory of your interfaces (API Catalog)",
  "OAuth discovery": "Where an agent signs in (OAuth discovery)",
  "OAuth Protected Resource": "What signing in gives access to (OAuth Protected Resource)",
  "Auth.md": "Sign-in instructions written for agents (Auth.md)",
  "MCP Server Card": "A list of tools agents may use (MCP Server Card)",
  "A2A Agent Card": "How another agent should talk to yours (A2A Agent Card)",
  WebMCP: "Tools offered inside the page itself (WebMCP)",
  x402: "Pay per request (x402)",
  MPP: "Payments made by machines (MPP)",
  UCP: "A shared way to describe products (UCP)",
  ACP: "Checkout an agent can complete (ACP)",
};

/** The group headings, where the key was trade shorthand rather than a phrase. */
export const AGENT_GROUP_LABEL: Readonly<Record<string, string>> = {
  "Content Accessibility": "Readable content",
  "API / Auth / MCP": "Interfaces, signing in, and agent tools",
};

/** The words for one check. Falls through to the key when it needs no help. */
export function agentCheckLabel(name: string): string {
  return AGENT_CHECK_LABEL[name] ?? name;
}

/** The words for one group. Same fall-through. */
export function agentGroupLabel(name: string): string {
  return AGENT_GROUP_LABEL[name] ?? name;
}

export function isKnownAgentIgnoreTarget(scope: "check" | "group", value: string): boolean {
  return scope === "group"
    ? AGENT_CHECK_GROUPS.some((group) => group.name === value)
    : ALL_AGENT_CHECKS.some((check) => `${check.group}\u001f${check.name}` === value);
}
