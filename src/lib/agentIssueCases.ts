/**
 * Canonical agent-access issue cases.
 *
 * Page Watch has three independent readings of agent readiness, at two
 * different scopes, using two different result models:
 *
 *   - Page Watch HTTP checks: page-level, boolean, every collection.
 *   - Kitesurf: page-level rendered/runtime evidence, every production run.
 *   - Ora: origin-level, applicability-aware, on explicit refresh.
 *
 * Showing three lists invites users to average them, which is exactly what the
 * plan forbids. This module instead merges them into one issue case per
 * problem, keeps every source reading intact underneath, and states plainly how
 * confident Page Watch is and why.
 *
 * Two rules the assembler enforces:
 *   1. A provider's prose is evidence, never a promise. Remediation shown to
 *      users is Page Watch's own wording; the provider's original text stays
 *      attached to its source reading.
 *   2. Ignored, not-applicable, unavailable, partial, and failed are five
 *      distinct outcomes and never collapse into one another.
 */

import type { AgentCheck, AgentIgnoreSettings, KitesurfEvidence } from "./types";
import { isAgentCheckIgnored } from "./agentScoring";
import type {
  ExternalAgentAuditSnapshot,
  ExternalAgentCheckResult,
  ExternalAgentFinding,
  ExternalAgentOriginAudit,
  ExternalAgentTier,
} from "./agentAudit";
import { latestExternalAgentSnapshot } from "./agentAudit";

export type AgentIssueScope = "origin" | "page";

/**
 * Outcome of one issue case. Mirrors the provider-neutral result vocabulary
 * plus `ignored`, which is a user policy decision rather than evidence.
 */
export type AgentIssueStatus =
  | "failed"
  | "partial"
  | "pass"
  | "not-applicable"
  | "unavailable"
  | "ignored";

/**
 * How much weight the conclusion carries. Independence matters more than
 * volume: two readings from the same system are still one source.
 */
export type AgentIssueConfidence =
  | "corroborated"
  | "single-source"
  | "conflicting"
  | "insufficient";

export type AgentEvidenceSystem = "page-watch" | "kitesurf" | "ora";

/**
 * Which half of agent access a problem sits in.
 *
 * Two halves, in this order, because the first is the precondition for the
 * second: an agent must reach the origin before anything it reads there can
 * matter. `reach` covers admission and discovery — the origin refuses the
 * agent, or never tells it where to go. `comprehension` covers everything
 * after the response arrives: the agent got in and could not parse, or could
 * not act on, what it was given.
 *
 * This is NOT a second verdict. It never renders as a state, a chip or a
 * count; it selects which of two sentences the verdict's subline says. A
 * second verdict splitting reach from comprehension was considered and
 * deferred, and adding one needs an amendment to `agent_verdict` in
 * `vocabulary.json` rather than a new union here.
 */
export type AgentHalf = "reach" | "comprehension";

export interface AgentIssueSource {
  system: AgentEvidenceSystem;
  /** Display label for the individual reading, e.g. the check name. */
  label: string;
  result: AgentIssueStatus;
  scope: AgentIssueScope;
  observedAt?: string;
  /** The provider's own words, retained separately from Page Watch guidance. */
  detail?: string;
  /** Stable provider check id, where the source has one. */
  providerCheckId?: string;
}

export interface AgentIssueCase {
  key: string;
  title: string;
  /** Why this matters to an agent, in plain language. */
  consequence: string;
  scope: AgentIssueScope;
  /** Which half of agent access is at fault when this case is failing. */
  half: AgentHalf;
  status: AgentIssueStatus;
  tier: ExternalAgentTier;
  confidence: AgentIssueConfidence;
  /** Set when sources disagree; describes the disagreement, never hides it. */
  conflict?: string;
  sources: AgentIssueSource[];
  /** Ordered steps in Page Watch's words, not the provider's. */
  remediation: string[];
  /** What must become true for this to count as fixed. */
  successCriteria: string;
  /** Provider check ids to re-run after a fix. Empty when no provider covers it. */
  verificationCheckIds: string[];
}

interface IssueFamily {
  /**
   * Required, so a family added without deciding which half it belongs to is a
   * compile error rather than a case that renders a verdict with no subline.
   */
  half: AgentHalf;
  title: string;
  consequence: string;
  scope: AgentIssueScope;
  remediation: string[];
  successCriteria: string;
  /** Page Watch HTTP check names that belong to this family. */
  localChecks?: string[];
  /** Stable Ora check ids that belong to this family. */
  oraChecks?: string[];
}

/**
 * Issue families. Each one is a problem a user can act on, not a check.
 *
 * A family may be evidenced by Page Watch alone, Ora alone, or both. Only clear
 * semantic equivalents are grouped; a provider check with no confident local
 * counterpart keeps its own family rather than being folded into a neighbour.
 *
 * Every family declares its `half`. The line between the two is admission and
 * discovery on one side, and what the agent can do with the response on the
 * other: robots policy, bot management, sitemaps, link headers, DNS discovery,
 * rate limits, OAuth discovery, Web Bot Auth and MCP discovery all decide
 * whether the agent gets in and finds the door, so they are `reach`. Markdown,
 * no-JS content, error shapes, OpenAPI, scopes, auth docs, MCP resources,
 * WebMCP, agent cards, skills indexes and payment protocols are all read or
 * used after a response arrives, so they are `comprehension`.
 */
export const AGENT_ISSUE_FAMILIES: Readonly<Record<string, IssueFamily>> = {
  "agent-discoverability:robots": {
    half: "reach",
    title: "Agent crawler policy is unclear",
    consequence: "Agents read robots.txt before anything else. An unclear or hostile policy stops well-behaved agents from reading the site at all.",
    scope: "origin",
    remediation: [
      "Publish a robots.txt that names the AI user agents you intend to allow.",
      "State an explicit Allow or Disallow for each; silence is read as ambiguity.",
      "Keep the policy consistent with any Content Signals or bot-management rules already in force.",
    ],
    successCriteria: "robots.txt resolves and states an explicit policy for AI user agents.",
    localChecks: ["robots.txt", "AI bot rules", "Content Signals"],
    oraChecks: ["robots-ai-policy-quality", "robots-agent-user-policy"],
  },
  "agent-access:reachability": {
    half: "reach",
    title: "Agents are blocked before they reach the page",
    consequence: "Bot management or edge rules reject agent traffic, so no other signal on the site can be read.",
    scope: "origin",
    remediation: [
      "Confirm whether bot management is challenging the agent user agents you allow in robots.txt.",
      "Allow the verified agent traffic you intend to serve, or state the block deliberately.",
    ],
    successCriteria: "A documented agent user agent receives a normal response instead of a challenge.",
    oraChecks: ["bot-detection", "agent-crawler-reachability"],
  },
  "agent-discoverability:sitemap": {
    half: "reach",
    title: "Agents cannot enumerate the site",
    consequence: "Without a reachable sitemap an agent has to guess which URLs exist, so it finds less of the site and re-crawls more often.",
    scope: "origin",
    remediation: [
      "Publish a sitemap and reference it from robots.txt.",
      "Keep lastmod values accurate so agents can skip unchanged pages.",
    ],
    successCriteria: "A sitemap resolves and is referenced from robots.txt.",
    localChecks: ["Sitemap"],
    oraChecks: ["sitemap", "sitemap-lastmod"],
  },
  "agent-discoverability:link-headers": {
    half: "reach",
    title: "Related resources are not discoverable from HTTP",
    consequence: "Link headers let an agent find alternates and related documents without parsing the page. Without them it has to render first.",
    scope: "origin",
    remediation: ["Emit RFC 8288 Link headers for alternates and related agent resources."],
    successCriteria: "Responses carry Link headers pointing at the intended agent resources.",
    localChecks: ["Link headers"],
    oraChecks: ["link-headers-discovery"],
  },
  "agent-discoverability:dns": {
    half: "reach",
    title: "No DNS-level agent discovery record",
    consequence: "DNS-AID lets an agent find the site's agent entry points before making a single HTTP request.",
    scope: "origin",
    remediation: ["Publish a DNS for AI Discovery record pointing at the agent resources you expose."],
    successCriteria: "A DNS-AID record resolves for the domain.",
    localChecks: ["DNS for AI Discovery (DNS-AID)"],
  },
  "agent-content:markdown": {
    half: "comprehension",
    title: "Agents cannot get a clean text version of the page",
    consequence: "Agents parse Markdown far more reliably than rendered HTML. Without negotiation they burn context on markup, or misread the page.",
    scope: "origin",
    remediation: [
      "Serve Markdown when the request asks for text/markdown.",
      "Add Vary: Accept so caches never hand HTML to an agent that asked for Markdown.",
    ],
    successCriteria: "A text/markdown request returns Markdown and the response carries Vary: Accept.",
    localChecks: ["Markdown negotiation"],
    oraChecks: ["markdown-negotiation", "markdown-negotiation-vary"],
  },
  "agent-content:no-js": {
    half: "comprehension",
    title: "The page has no content without JavaScript",
    consequence: "Most agents do not execute JavaScript. If the primary content only appears after hydration, they see an empty page.",
    scope: "origin",
    remediation: [
      "Server-render the primary content, or provide a no-JavaScript fallback for the main route.",
      "Verify by fetching the page with scripting disabled and confirming the main content is present.",
    ],
    successCriteria: "The primary content is present in the initial HTML response.",
    oraChecks: ["content-no-js"],
  },
  "agent-http:recovery": {
    half: "comprehension",
    title: "Missing pages do not return a real error",
    consequence: "A soft 404 teaches an agent that a wrong URL is a valid page, so it keeps following and citing broken links.",
    scope: "origin",
    remediation: [
      "Return a 404 status for unknown paths.",
      "Include a short machine-readable body describing the error.",
    ],
    successCriteria: "An unknown path returns a 404 with a machine-readable body.",
    oraChecks: ["agent-friendly-404"],
  },
  "agent-api:openapi": {
    half: "comprehension",
    title: "Agents cannot reliably discover machine-readable API documentation",
    consequence: "Without a published contract an agent has to infer endpoints and parameters from prose, which it will get wrong.",
    scope: "origin",
    remediation: [
      "Publish an OpenAPI document for the public API.",
      "Link it from the API documentation and expose it from the API catalog.",
    ],
    successCriteria: "An OpenAPI document is reachable and referenced from the API catalog.",
    localChecks: ["API Catalog"],
    oraChecks: ["openapi-spec", "api-catalog-rfc9727", "public-api-docs"],
  },
  "agent-api:errors": {
    half: "comprehension",
    title: "API errors are not machine-readable",
    consequence: "An agent that cannot tell a rate limit from a validation failure retries the wrong thing, or gives up on a recoverable error.",
    scope: "origin",
    remediation: [
      "Return errors as JSON with a stable shape.",
      "Give each failure a typed, documented error code.",
    ],
    successCriteria: "Error responses are JSON and carry a stable, documented error type.",
    oraChecks: ["json-error-responses", "api-error-model"],
  },
  "agent-api:rate-limits": {
    half: "reach",
    title: "Rate limits are invisible to agents",
    consequence: "Without rate-limit headers an agent cannot pace itself, so it either backs off far too hard or keeps hitting the limit.",
    scope: "origin",
    remediation: ["Send RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset on API responses."],
    successCriteria: "API responses carry standard rate-limit headers.",
    oraChecks: ["rate-limit-headers"],
  },
  "agent-auth:oauth": {
    half: "reach",
    title: "Agents cannot discover how to authenticate",
    consequence: "Without discoverable OAuth metadata an agent cannot begin an authorization flow on its own.",
    scope: "origin",
    remediation: [
      "Publish OAuth authorization server metadata at its well-known location.",
      "Expose protected-resource metadata (RFC 9728) for the API.",
    ],
    successCriteria: "OAuth discovery and protected-resource metadata both resolve.",
    localChecks: ["OAuth discovery", "OAuth Protected Resource"],
    oraChecks: ["oauth-support", "oauth-protected-resource"],
  },
  "agent-auth:scopes": {
    half: "comprehension",
    title: "Permissions are not scoped for agents",
    consequence: "Without documented scopes an agent must request more access than the task needs, which users are right to refuse.",
    scope: "origin",
    remediation: ["Document and enforce per-endpoint scopes so an agent can request the minimum it needs."],
    successCriteria: "Scopes are documented and enforced per endpoint.",
    oraChecks: ["scoped-permissions"],
  },
  "agent-auth:docs": {
    half: "comprehension",
    title: "Authentication is not documented for agents",
    consequence: "An agent that cannot read how to authenticate will not attempt the flow at all.",
    scope: "origin",
    remediation: ["Publish an auth.md describing the authentication flow in a form an agent can follow."],
    successCriteria: "auth.md resolves and describes the flow.",
    localChecks: ["Auth.md"],
    oraChecks: ["auth-md-exists", "auth-md-structure"],
  },
  "agent-auth:bot-auth": {
    half: "reach",
    title: "Verified agent traffic cannot be distinguished",
    consequence: "Without Web Bot Auth the site cannot tell a verified agent from an impostor, so it has to treat both the same way.",
    scope: "origin",
    remediation: ["Publish a Web Bot Auth directory entry so verified agent traffic can be recognized."],
    successCriteria: "A Web Bot Auth directory entry resolves for the domain.",
    localChecks: ["Web Bot Auth"],
    oraChecks: ["web-bot-auth-directory"],
  },
  "agent-mcp:discovery": {
    half: "reach",
    title: "No MCP server is discoverable",
    consequence: "MCP is how an agent takes action rather than only reading. Without a discoverable server the site is read-only to agents.",
    scope: "origin",
    remediation: [
      "Publish an MCP server and expose it from its well-known location.",
      "Include a server card so agents can tell what the server is for.",
    ],
    successCriteria: "An MCP server responds to initialize and is discoverable from a well-known location.",
    localChecks: ["MCP Server Card"],
    oraChecks: ["mcp-server", "mcp-well-known-discovery", "mcp-server-card"],
  },
  "agent-mcp:resources": {
    half: "comprehension",
    title: "MCP resources are missing or poorly described",
    consequence: "An agent chooses tools by their descriptions. Thin or missing resource metadata makes it pick the wrong one.",
    scope: "origin",
    remediation: [
      "Expose the resources agents need through resources/list.",
      "Give every resource a description that says when to use it.",
    ],
    successCriteria: "resources/list returns described resources.",
    oraChecks: ["mcp-resource-listing", "mcp-resource-quality"],
  },
  "agent-mcp:webmcp": {
    half: "comprehension",
    title: "The page exposes no in-page agent interface",
    consequence: "WebMCP lets an agent act on the page it is already reading instead of finding a separate API.",
    scope: "origin",
    remediation: ["Expose a WebMCP interface for the actions agents should be able to take in-page."],
    successCriteria: "A WebMCP interface is detected on the page.",
    localChecks: ["WebMCP"],
    oraChecks: ["webmcp"],
  },
  "agent-a2a:card": {
    half: "comprehension",
    title: "No agent card is published",
    consequence: "An A2A agent card is how other agents learn what this product's agent can do.",
    scope: "origin",
    remediation: ["Publish an A2A agent card describing the agent's capabilities."],
    successCriteria: "An A2A agent card resolves.",
    localChecks: ["A2A Agent Card"],
    oraChecks: ["a2a-agent-card"],
  },
  "agent-skills:index": {
    half: "comprehension",
    title: "No agent skills index is published",
    consequence: "A skills index tells an agent which packaged capabilities exist instead of making it infer them.",
    scope: "origin",
    remediation: ["Publish an agent skills index conforming to the current specification."],
    successCriteria: "A conforming skills index resolves.",
    localChecks: ["Agent Skills"],
    oraChecks: ["agent-skills-index-v2"],
  },
  "agent-commerce:protocols": {
    half: "comprehension",
    title: "Agents cannot transact",
    consequence: "Without a supported payment protocol an agent can research a purchase but has to hand the last step back to a human.",
    scope: "origin",
    remediation: ["Support an agent payment protocol only if agent-initiated purchases are a real goal for this product."],
    successCriteria: "At least one agent payment protocol responds correctly.",
    localChecks: ["x402", "MPP", "UCP", "ACP"],
    oraChecks: ["x402-support", "mpp-support", "ucp-support", "acp-support", "acp-delegate-payment", "ap2-support"],
  },
};

/** Issue family for a Page Watch HTTP check name, when one is mapped. */
export function familyForLocalCheck(name: string): string | undefined {
  for (const [key, family] of Object.entries(AGENT_ISSUE_FAMILIES)) {
    if (family.localChecks?.includes(name)) return key;
  }
  return undefined;
}

/** Issue family for a stable Ora check id, when one is mapped. */
export function familyForOraCheck(providerCheckId: string): string | undefined {
  for (const [key, family] of Object.entries(AGENT_ISSUE_FAMILIES)) {
    if (family.oraChecks?.includes(providerCheckId)) return key;
  }
  return undefined;
}

const STATUS_SEVERITY: Record<AgentIssueStatus, number> = {
  failed: 0,
  partial: 1,
  unavailable: 2,
  ignored: 3,
  "not-applicable": 4,
  pass: 5,
};

const TIER_SEVERITY: Record<ExternalAgentTier, number> = {
  essential: 0,
  recommended: 1,
  emerging: 2,
  unclassified: 3,
};

function localResult(
  check: AgentCheck,
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): AgentIssueStatus {
  if (isAgentCheckIgnored(check, ignores, defaults, restores)) return "ignored";
  if (check.unavailable) return "unavailable";
  return check.pass ? "pass" : "failed";
}

function externalResult(result: ExternalAgentCheckResult): AgentIssueStatus {
  return result === "not-applicable" ? "not-applicable" : result;
}

/**
 * Resolve the case outcome from its readings. An ignored local check does not
 * silence provider evidence, and a not-applicable provider reading does not
 * override an observed local failure — the most severe *determined* reading
 * wins, with ignored/not-applicable only surviving when nothing was determined.
 */
function caseStatus(sources: AgentIssueSource[]): AgentIssueStatus {
  const determined = sources.filter((source) =>
    source.result === "failed" || source.result === "partial" || source.result === "pass");
  const pool = determined.length ? determined : sources;
  return pool.reduce<AgentIssueStatus>(
    (worst, source) => STATUS_SEVERITY[source.result] < STATUS_SEVERITY[worst] ? source.result : worst,
    "pass",
  );
}

/**
 * Confidence reflects how many *independent systems* agree, not how many checks
 * ran. Disagreement is reported as `conflicting` rather than averaged away.
 */
function caseConfidence(
  sources: AgentIssueSource[],
): { confidence: AgentIssueConfidence; conflict?: string } {
  const determined = sources.filter((source) =>
    source.result === "failed" || source.result === "partial" || source.result === "pass");
  if (determined.length === 0) return { confidence: "insufficient" };

  const systems = new Set(determined.map((source) => source.system));
  const negative = determined.filter((source) => source.result !== "pass");
  const positive = determined.filter((source) => source.result === "pass");

  if (negative.length > 0 && positive.length > 0) {
    const negativeSystems = [...new Set(negative.map((source) => source.system))].map(systemLabel);
    const positiveSystems = [...new Set(positive.map((source) => source.system))].map(systemLabel);
    return {
      confidence: "conflicting",
      conflict: `${negativeSystems.join(" and ")} reported a problem while ${positiveSystems.join(" and ")} did not. The readings differ in scope or method, so both are shown.`,
    };
  }
  return { confidence: systems.size > 1 ? "corroborated" : "single-source" };
}

export function systemLabel(system: AgentEvidenceSystem): string {
  return system === "page-watch" ? "Page Watch HTTP" : system === "kitesurf" ? "Kitesurf" : "Ora";
}

export interface AssembleAgentIssueCasesInput {
  /** Page Watch HTTP checks from the latest scan in range. */
  checks: AgentCheck[];
  checksObservedAt?: string;
  ignores?: AgentIgnoreSettings;
  ignoreDefaults?: AgentIgnoreSettings;
  ignoreRestores?: AgentIgnoreSettings;
  /** Origin-level provider audit covering this page, when one is stored. */
  audit?: ExternalAgentOriginAudit | null;
  kitesurf?: KitesurfEvidence | null;
}

/**
 * Merge every available reading into one case per issue family.
 *
 * Provider findings that map to no family are still returned, as their own
 * single-source case attributed to the provider, so nothing is silently
 * dropped just because Page Watch has no equivalent for it.
 */
export function assembleAgentIssueCases(
  input: AssembleAgentIssueCasesInput,
): AgentIssueCase[] {
  const snapshot: ExternalAgentAuditSnapshot | null = input.audit
    ? latestExternalAgentSnapshot(input.audit)
    : null;
  const sourcesByFamily = new Map<string, AgentIssueSource[]>();
  const checkIdsByFamily = new Map<string, string[]>();
  const add = (family: string, source: AgentIssueSource) => {
    sourcesByFamily.set(family, [...(sourcesByFamily.get(family) ?? []), source]);
    if (source.providerCheckId) {
      const existing = checkIdsByFamily.get(family) ?? [];
      if (!existing.includes(source.providerCheckId)) {
        checkIdsByFamily.set(family, [...existing, source.providerCheckId]);
      }
    }
  };

  for (const check of input.checks) {
    const family = familyForLocalCheck(check.name);
    if (!family) continue;
    add(family, {
      system: "page-watch",
      label: check.name,
      result: localResult(check, input.ignores, input.ignoreDefaults, input.ignoreRestores),
      scope: "page",
      ...(input.checksObservedAt ? { observedAt: input.checksObservedAt } : {}),
      ...(check.detail ? { detail: check.detail } : {}),
    });
  }

  // Kitesurf fetches the published page with a non-Chromium client, which is
  // the same question `agent-access:reachability` asks: does this origin serve
  // a normal response to something that is not a browser? Until S4 this input
  // was accepted and never read, so the kitesurf slot in the ledger had no
  // producer on the agent surface and its row could only ever say Unavailable
  // — registry rule 15, and the reason a probe that saw a 403 could not
  // contradict a Page Watch check that saw a 200.
  if (input.kitesurf) {
    const probe = input.kitesurf;
    const answered = probe.httpStatus !== undefined && probe.httpStatus >= 200 && probe.httpStatus < 400;
    add("agent-access:reachability", {
      system: "kitesurf",
      label: "Rendered page probe",
      result: probe.status !== "available" || probe.httpStatus === undefined
        ? "unavailable"
        : answered ? "pass" : "failed",
      scope: "page",
      observedAt: probe.capturedAt,
      // The probe's own reading, in its own terms. Never restated as a verdict.
      ...(probe.httpStatus === undefined ? {} : { detail: `HTTP ${probe.httpStatus}` }),
    });
  }

  const providerOnly: ExternalAgentFinding[] = [];
  for (const finding of snapshot?.findings ?? []) {
    const family = familyForOraCheck(finding.providerCheckId);
    if (!family) {
      providerOnly.push(finding);
      continue;
    }
    add(family, {
      system: "ora",
      label: finding.name,
      result: externalResult(finding.result),
      scope: "origin",
      observedAt: snapshot?.scannedAt,
      ...(finding.details ? { detail: finding.details } : {}),
      providerCheckId: finding.providerCheckId,
    });
  }

  const tierFor = (family: string): ExternalAgentTier => {
    const ids = checkIdsByFamily.get(family) ?? [];
    const tiers = (snapshot?.findings ?? [])
      .filter((finding) => ids.includes(finding.providerCheckId))
      .map((finding) => finding.tier);
    // Most severe tier among the provider checks backing this family.
    return tiers.reduce<ExternalAgentTier>(
      (best, tier) => TIER_SEVERITY[tier] < TIER_SEVERITY[best] ? tier : best,
      "unclassified",
    );
  };

  const cases: AgentIssueCase[] = [...sourcesByFamily.entries()].map(([key, sources]) => {
    const family = AGENT_ISSUE_FAMILIES[key];
    const status = caseStatus(sources);
    const { confidence, conflict } = caseConfidence(sources);
    return {
      key,
      title: family.title,
      consequence: family.consequence,
      scope: family.scope,
      half: family.half,
      status,
      tier: tierFor(key),
      confidence,
      ...(conflict ? { conflict } : {}),
      sources,
      remediation: family.remediation,
      successCriteria: family.successCriteria,
      verificationCheckIds: checkIdsByFamily.get(key) ?? [],
    };
  });

  // Provider checks with no Page Watch equivalent stay visible and attributed
  // to the provider rather than being guessed into a neighbouring family.
  for (const finding of providerOnly) {
    const status = externalResult(finding.result);
    cases.push({
      key: `ora:${finding.providerCheckId}`,
      title: finding.name,
      consequence: "Reported by Ora only. Page Watch has no independent check for this, so treat it as a single provider reading.",
      scope: "origin",
      // Comprehension, and not a guess: this reading exists only because the
      // provider reached the origin and evaluated something there. A check the
      // provider could run is by definition not a check the agent was refused,
      // so whatever it found wrong is on the far side of the response.
      half: "comprehension",
      status,
      tier: finding.tier,
      confidence: status === "not-applicable" || status === "unavailable"
        ? "insufficient"
        : "single-source",
      sources: [{
        system: "ora",
        label: finding.name,
        result: status,
        scope: "origin",
        observedAt: snapshot?.scannedAt,
        ...(finding.details ? { detail: finding.details } : {}),
        providerCheckId: finding.providerCheckId,
      }],
      // The provider's recommendation is shown as its words, clearly attributed,
      // because Page Watch has no independent basis for rewriting it.
      remediation: finding.recommendation
        ? [`Ora suggests: ${finding.recommendation}`]
        : ["Review the provider report for this check before acting."],
      successCriteria: `Ora reports ${finding.name} as passing or correctly not applicable.`,
      verificationCheckIds: [finding.providerCheckId],
    });
  }

  return cases.sort((left, right) =>
    STATUS_SEVERITY[left.status] - STATUS_SEVERITY[right.status]
    || TIER_SEVERITY[left.tier] - TIER_SEVERITY[right.tier]
    || left.title.localeCompare(right.title));
}

/** Cases a user could act on now. */
export function actionableAgentIssueCases(cases: AgentIssueCase[]): AgentIssueCase[] {
  return cases.filter((item) => item.status === "failed" || item.status === "partial");
}

/**
 * Essential blockers: an essential-tier issue that is actually failing. Partial
 * essential findings are real problems but are not treated as blocking, so the
 * word keeps a precise meaning.
 */
export function essentialAgentBlockers(cases: AgentIssueCase[]): AgentIssueCase[] {
  return cases.filter((item) => item.status === "failed" && item.tier === "essential");
}

/**
 * Cases whose determined sources do not agree with each other.
 *
 * `caseConfidence` has already worked this out per case and recorded it; this
 * is the one place that reads it back, so "the sources disagree" is asked as a
 * question about the ledger rather than recomputed from the readings a second
 * time and allowed to drift from the sentence shown beside them.
 */
export function disputedAgentIssueCases(cases: readonly AgentIssueCase[]): AgentIssueCase[] {
  return cases.filter((item) => item.confidence === "conflicting");
}

/**
 * Cases where at least one system actually determined a result.
 *
 * Not the same as "cases": a family every system reported Unavailable on has a
 * row and no reading, and registry rule 18 says an absent measurement is not a
 * small one.
 */
export function determinedAgentIssueCases(cases: readonly AgentIssueCase[]): AgentIssueCase[] {
  return cases.filter((item) => item.confidence !== "insufficient");
}
