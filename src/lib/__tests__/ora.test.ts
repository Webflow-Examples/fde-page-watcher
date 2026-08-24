import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyOraResponse,
  clampOraMaxAgeSeconds,
  isAuditableOraTarget,
  isOraPreviewHost,
  normalizeOraTarget,
  oraAvailabilityFromOutcome,
  oraCheckResult,
  oraDomainMatchesHost,
  oraIssueKeyForCheck,
  oraOriginKeyFragment,
  oraPollUrl,
  oraRetryAfterSeconds,
  oraScanUrl,
  oraScoreUrl,
  oraTier,
  OraContractError,
  OraTargetError,
  ORA_MAX_DETAILS_LENGTH,
  ORA_MAX_MAX_AGE_SECONDS,
  ORA_MIN_MAX_AGE_SECONDS,
  parseOraAuditResponse,
} from "../ora";
import type { ExternalAgentFinding } from "../agentAudit";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(__dirname, "fixtures", `ora-audit-${name}.json`), "utf8"),
  ) as unknown;
}

const ORIGIN = "https://example.com";

function parse(name: string, overrides: Record<string, unknown> = {}) {
  return parseOraAuditResponse({ ...fixture(name) as object, ...overrides }, {
    origin: ORIGIN,
    rawReportKey: "agent-audits/t/ora/abc/2026-08-24.json",
    fetchedAt: "2026-08-24T06:00:00.000Z",
  });
}

function findingFor(findings: ExternalAgentFinding[], id: string): ExternalAgentFinding {
  const match = findings.find((finding) => finding.providerCheckId === id);
  if (!match) throw new Error(`fixture is missing check ${id}`);
  return match;
}

describe("Ora target normalization", () => {
  it("reduces a watched page URL to its public origin", () => {
    expect(normalizeOraTarget("https://example.com/pricing?utm=1#top")).toEqual({
      origin: "https://example.com",
      host: "example.com",
    });
    expect(normalizeOraTarget("example.com").origin).toBe("https://example.com");
    expect(normalizeOraTarget("HTTP://Example.COM:8080/a").origin).toBe("http://example.com:8080");
  });

  it.each([
    ["", "invalid-url"],
    ["   ", "invalid-url"],
    ["https://", "invalid-url"],
    ["ftp://example.com", "unsupported-scheme"],
    ["file:///etc/passwd", "unsupported-scheme"],
    ["javascript:alert(1)", "unsupported-scheme"],
    ["https://user:pass@example.com", "credentials-present"],
    ["https://localhost:3000", "private-host"],
    ["https://app.localhost", "private-host"],
    ["https://box.local", "private-host"],
    ["https://svc.internal", "private-host"],
    ["https://nas.lan", "private-host"],
    ["https://127.0.0.1", "private-host"],
    ["https://10.1.2.3", "private-host"],
    ["https://192.168.0.5", "private-host"],
    ["https://172.16.4.4", "private-host"],
    ["https://169.254.169.254", "private-host"],
    ["https://[::1]", "private-host"],
    ["https://[fd00::1]", "private-host"],
    ["https://client-site.webflow.io", "preview-host"],
    ["https://client-site.webflow.io/pricing", "preview-host"],
    ["https://webflow.io", "preview-host"],
    ["https://deep.nested.webflow.io", "preview-host"],
    ["WEBFLOW.IO", "preview-host"],
  ])("refuses %s before any request can be made", (input, code) => {
    expect(() => normalizeOraTarget(input)).toThrow(OraTargetError);
    try {
      normalizeOraTarget(input);
    } catch (error) {
      expect((error as OraTargetError).code).toBe(code);
    }
    expect(isAuditableOraTarget(input)).toBe(false);
  });

  it("accepts an ordinary public origin", () => {
    expect(isAuditableOraTarget("https://webflow.com/blog")).toBe(true);
  });

  it("refuses Webflow staging hosts but not lookalikes", () => {
    // A public Ora scan attributes a subdomain to its parent company's
    // leaderboard row, so staging hostnames must never leave Page Watch.
    expect(isOraPreviewHost("client-site.webflow.io")).toBe(true);
    expect(isOraPreviewHost("webflow.io")).toBe(true);
    expect(isOraPreviewHost("webflow.io.")).toBe(true);
    expect(isOraPreviewHost("Client-Site.WEBFLOW.IO")).toBe(true);

    // Production domains, including Webflow's own, stay auditable.
    expect(isOraPreviewHost("webflow.com")).toBe(false);
    expect(isOraPreviewHost("blog.webflow.com")).toBe(false);
    // Not a subdomain of webflow.io, despite the shared substring.
    expect(isOraPreviewHost("notwebflow.io")).toBe(false);
    expect(isOraPreviewHost("mywebflow.io")).toBe(false);
    expect(isOraPreviewHost("webflow.io.evil.test")).toBe(false);
    expect(isAuditableOraTarget("https://acme.com")).toBe(true);
  });
});

describe("Ora request helpers", () => {
  it("clamps the freshness policy into Ora's documented bounds", () => {
    expect(clampOraMaxAgeSeconds(undefined)).toBe(86_400);
    expect(clampOraMaxAgeSeconds(60)).toBe(ORA_MIN_MAX_AGE_SECONDS);
    expect(clampOraMaxAgeSeconds(999_999)).toBe(ORA_MAX_MAX_AGE_SECONDS);
    expect(clampOraMaxAgeSeconds(7_200)).toBe(7_200);
    expect(clampOraMaxAgeSeconds(Number.NaN)).toBe(86_400);
  });

  it("always requests the versioned audit shape with essentials", () => {
    expect(oraScanUrl()).toBe("https://ora.ai/api/scan?format=audit&include=essentials");
    expect(oraScoreUrl("example.com"))
      .toBe("https://ora.ai/api/score/example.com?format=audit&include=essentials");
  });

  it("polls only the provider's own Location URL", () => {
    expect(oraPollUrl("/api/score/example.com"))
      .toBe("https://ora.ai/api/score/example.com?format=audit&include=essentials");
    expect(oraPollUrl("https://ora.ai/api/score/example.com?format=audit"))
      .toBe("https://ora.ai/api/score/example.com?format=audit&include=essentials");
    expect(oraPollUrl("https://evil.test/api/score/example.com")).toBeNull();
    expect(oraPollUrl("//evil.test/x")).toBeNull();
    expect(oraPollUrl(null)).toBeNull();
    // On-origin but outside the documented score route.
    expect(oraPollUrl("not a url")).toBeNull();
    expect(oraPollUrl("/api/scan")).toBeNull();
    expect(oraPollUrl("/")).toBeNull();
  });
});

describe("Ora status and tier mapping", () => {
  it("maps every documented check status, keeping partial distinct", () => {
    expect(oraCheckResult("pass")).toBe("pass");
    expect(oraCheckResult("warning")).toBe("partial");
    expect(oraCheckResult("fail")).toBe("failed");
    expect(oraCheckResult("na")).toBe("not-applicable");
    // Neither a provider-side failure nor an unfinished check is a site failure.
    expect(oraCheckResult("error")).toBe("unavailable");
    expect(oraCheckResult("pending")).toBe("unavailable");
    expect(oraCheckResult("a-status-ora-adds-later")).toBe("unavailable");
    expect(oraCheckResult(undefined)).toBe("unavailable");
  });

  it("maps documented tiers and leaves anything else unclassified", () => {
    expect(oraTier("required")).toBe("essential");
    expect(oraTier("recommended")).toBe("recommended");
    expect(oraTier("emerging")).toBe("emerging");
    expect(oraTier("something-new")).toBe("unclassified");
    expect(oraTier(undefined)).toBe("unclassified");
  });

  it("crosswalks only documented check ids and leaves the rest provider-specific", () => {
    expect(oraIssueKeyForCheck("openapi-spec")).toBe("agent-api:openapi");
    expect(oraIssueKeyForCheck("robots-agent-user-policy")).toBe("agent-discoverability:robots");
    expect(oraIssueKeyForCheck("mcp-resource-quality")).toBe("agent-mcp:resources");
    expect(oraIssueKeyForCheck("wikipedia-presence")).toBeUndefined();
    expect(oraIssueKeyForCheck("not-a-real-check")).toBeUndefined();
    // A provider id colliding with Object.prototype must not resolve.
    expect(oraIssueKeyForCheck("toString")).toBeUndefined();
    expect(oraIssueKeyForCheck("constructor")).toBeUndefined();
    expect(oraIssueKeyForCheck("__proto__")).toBeUndefined();
  });

  it("matches the exact host, tolerating only a www. prefix", () => {
    // Measured 2026-08-24: the provider echoes the full hostname, so exact
    // match is the normal case.
    expect(oraDomainMatchesHost("example.com", "example.com")).toBe(true);
    expect(oraDomainMatchesHost("EXAMPLE.COM.", "example.com")).toBe(true);
    expect(oraDomainMatchesHost("docs.example.com", "docs.example.com")).toBe(true);
    // A redirect can add or drop www on either side.
    expect(oraDomainMatchesHost("example.com", "www.example.com")).toBe(true);
    expect(oraDomainMatchesHost("www.example.com", "example.com")).toBe(true);

    expect(oraDomainMatchesHost("notexample.com", "example.com")).toBe(false);
    expect(oraDomainMatchesHost("", "example.com")).toBe(false);
  });

  it("refuses a reply about a shared parent of the host we asked about", () => {
    // The reason the guard exists: on a shared domain, folding to the parent
    // would describe an entirely different site.
    expect(oraDomainMatchesHost("webflow.io", "customer.webflow.io")).toBe(false);
    expect(oraDomainMatchesHost("example.com", "docs.example.com")).toBe(false);
    expect(oraDomainMatchesHost("docs.example.com", "example.com")).toBe(false);
  });
});

describe("Ora audit fixture round-trip", () => {
  it("normalizes a complete audit into the provider-neutral snapshot", () => {
    const snapshot = parse("complete");
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.provider).toBe("ora");
    expect(snapshot.contractVersion).toBe("1.21.0");
    expect(snapshot.status).toBe("available");
    expect(snapshot.origin).toBe(ORIGIN);
    expect(snapshot.target).toBe(ORIGIN);
    expect(snapshot.score).toBe(61);
    expect(snapshot.grade).toBe("C");
    expect(snapshot.scannedAt).toBe("2026-08-24T04:12:09.482Z");
    expect(snapshot.fetchedAt).toBe("2026-08-24T06:00:00.000Z");
    expect(snapshot.reportUrl).toBe("https://ora.ai/score/example.com");
    expect(snapshot.rawReportKey).toBe("agent-audits/t/ora/abc/2026-08-24.json");
    expect(snapshot.pendingChecks).toBeUndefined();
    expect(snapshot.findings).toHaveLength(17);
  });

  it("keeps the essentials reading intact and unaveraged", () => {
    const { essentials, score } = parse("complete");
    // The provider score and the essentials score stay independent readings.
    expect(score).toBe(61);
    expect(essentials?.score).toBe(63);
    expect(essentials?.label).toBe("Needs attention");
    // Ora's `required` budget becomes the neutral `essential` bucket.
    expect(essentials?.essential).toEqual({ earned: 50, available: 80, passing: 5, total: 8 });
    expect(essentials?.recommended).toEqual({ earned: 13, available: 20, passing: 2, total: 3 });
    expect(essentials?.bonusPoints).toBe(1.5);
    // Provider-sorted; rendered in order, never re-ranked.
    expect(essentials?.issues).toEqual([
      "content-no-js",
      "openapi-spec",
      "agent-friendly-404",
      "markdown-negotiation-vary",
      "rate-limit-headers",
    ]);
  });

  it("maps each documented status onto a distinct result", () => {
    const { findings } = parse("complete");
    expect(findingFor(findings, "sitemap").result).toBe("pass");
    expect(findingFor(findings, "content-no-js").result).toBe("failed");
    expect(findingFor(findings, "markdown-negotiation-vary").result).toBe("partial");
    expect(findingFor(findings, "pricing-info").result).toBe("not-applicable");
    expect(findingFor(findings, "function-calling-compat").result).toBe("unavailable");
    // The raw status survives so `error` never reads as a finished determination.
    expect(findingFor(findings, "function-calling-compat").providerStatus).toBe("error");
  });

  it("treats not-applicable as provider evidence, not a user policy", () => {
    const finding = findingFor(parse("complete").findings, "pricing-info");
    expect(finding.result).toBe("not-applicable");
    expect(finding.applicability)
      .toBe("This domain does not publish a commercial offering, so pricing does not apply.");
  });

  it("keeps the two provider tiers separate and bonus orthogonal to tier", () => {
    const { findings } = parse("complete");
    const markdown = findingFor(findings, "markdown-negotiation-vary");
    // Ora documents that its audit tier and essentials tier diverge by design.
    expect(markdown.auditTier).toBe("recommended");
    expect(markdown.essentialsTier).toBe("essential");
    expect(markdown.tier).toBe("essential");
    expect(markdown.bonus).toBe(true);
    expect(markdown.essentialsBonus).toBe(true);

    // A check excluded from the essentials model keeps only its audit tier.
    const robots = findingFor(findings, "robots-ai-policy-quality");
    expect(robots.auditTier).toBe("essential");
    expect(robots.essentialsTier).toBeUndefined();
    expect(robots.tier).toBe("essential");
  });

  it("never merges the two gain scales", () => {
    const finding = findingFor(parse("complete").findings, "content-no-js");
    expect(finding.estScoreGain).toBe(6);
    expect(finding.essentialsGain).toBe(10);
    expect(finding.fraction).toBe(0);
    // A finding with no essentials entry carries no essentials gain.
    expect(findingFor(parse("complete").findings, "robots-ai-policy-quality").essentialsGain)
      .toBeUndefined();
  });

  it("prefers an essentials recommendation only where Ora overrides its own copy", () => {
    const { findings } = parse("complete");
    expect(findingFor(findings, "content-no-js").recommendation)
      .toBe("Server-render the primary content so an agent without JavaScript sees the same page a browser does.");
    expect(findingFor(findings, "openapi-spec").recommendation)
      .toBe("Publish an OpenAPI 3.1 document and link it from the API documentation.");
  });

  it("attaches Page Watch issue keys only to crosswalked checks", () => {
    const { findings } = parse("complete");
    expect(findingFor(findings, "openapi-spec").issueKey).toBe("agent-api:openapi");
    expect(findingFor(findings, "agent-friendly-404").issueKey).toBe("agent-http:recovery");
    expect(findingFor(findings, "rate-limit-headers").issueKey).toBe("agent-api:rate-limits");
    expect(findingFor(findings, "wikipedia-presence").issueKey).toBeUndefined();
    expect(findingFor(findings, "wikipedia-presence").name)
      .toBe("Wikipedia / Wikidata entity presence");
  });

  it("keeps one reading per MCP surface for a repeated check id", () => {
    const readings = parse("complete").findings
      .filter((finding) => finding.providerCheckId === "mcp-resource-listing");
    expect(readings).toHaveLength(2);
    expect(readings.map((finding) => finding.result)).toEqual(["pass", "partial"]);
  });

  it("records a layer as the provider category", () => {
    expect(findingFor(parse("complete").findings, "content-no-js").category).toBe("accessibility");
    expect(findingFor(parse("complete").findings, "x402-support").category).toBe("payments");
  });
});

describe("Ora partial and unevaluable audits", () => {
  it("reports a partial analysis as partial and keeps the pending ids", () => {
    const snapshot = parse("partial");
    expect(snapshot.status).toBe("partial");
    expect(snapshot.pendingChecks).toEqual(["openapi-spec", "mcp-server", "rate-limit-headers"]);
    expect(findingFor(snapshot.findings, "openapi-spec").result).toBe("unavailable");
    expect(findingFor(snapshot.findings, "openapi-spec").providerStatus).toBe("pending");
    // Ora returns a null essentials score when too few checks apply.
    expect(snapshot.essentials?.score).toBeNull();
  });

  it("cannot be talked back into 'available' by a complete-looking body", () => {
    const snapshot = parseOraAuditResponse(fixture("complete"), {
      origin: ORIGIN,
      rawReportKey: "k",
      forcePartial: true,
    });
    expect(snapshot.status).toBe("partial");
  });

  it("withholds the score when the provider could not evaluate the target", () => {
    const snapshot = parse("mcp-auth-required");
    // score 0 with empty layers means "could not evaluate", not a real zero.
    expect(snapshot.score).toBeNull();
    expect(snapshot.findings).toEqual([]);
    expect(snapshot.essentials).toBeUndefined();
  });

  it("marks a stuck analysis partial", () => {
    expect(parse("complete", { analysisStatus: "stuck" }).status).toBe("partial");
  });

  it("marks an otherwise complete body partial when checks are still pending", () => {
    expect(parse("complete", { pendingChecks: ["openapi-spec"] }).status).toBe("partial");
  });
});

describe("Ora contract validation", () => {
  it.each([
    ["a non-object body", "hello", "not-an-object"],
    ["a null body", null, "not-an-object"],
    ["an array body", [], "not-an-object"],
  ])("rejects %s", (_label, body, code) => {
    expect(() => parseOraAuditResponse(body, { origin: ORIGIN, rawReportKey: "k" }))
      .toThrow(OraContractError);
    try {
      parseOraAuditResponse(body, { origin: ORIGIN, rawReportKey: "k" });
    } catch (error) {
      expect((error as OraContractError).code).toBe(code);
    }
  });

  it.each([
    ["contractVersion is absent (the default format was returned)", { contractVersion: undefined }, "missing-contract-version"],
    ["the envelope major changed", { contractVersion: "2.0.0" }, "contract-major-mismatch"],
    ["the source is not Ora", { source: "somewhere-else" }, "unexpected-source"],
    ["the domain is missing", { domain: undefined }, "missing-domain"],
    ["the domain is unrelated to the origin", { domain: "attacker.test" }, "domain-mismatch"],
    ["scannedAt is unusable", { scannedAt: "not a date" }, "invalid-scanned-at"],
    ["layers are missing", { layers: undefined }, "missing-layers"],
    ["the score is missing", { score: undefined }, "missing-score"],
    ["the score is not a number", { score: "sixty" }, "missing-score"],
  ])("refuses to persist a reading when %s", (_label, overrides, code) => {
    try {
      parse("complete", overrides as Record<string, unknown>);
      throw new Error("expected a contract error");
    } catch (error) {
      expect(error).toBeInstanceOf(OraContractError);
      expect((error as OraContractError).code).toBe(code);
    }
  });

  it("accepts an additive minor bump within the pinned major", () => {
    expect(parse("complete", { contractVersion: "1.99.0" }).contractVersion).toBe("1.99.0");
  });

  it("tolerates a body missing fields Page Watch does not read", () => {
    const snapshot = parse("complete", {
      name: undefined,
      gradeColor: undefined,
      ctaMessage: undefined,
      durationMs: undefined,
      topFixes: undefined,
    });
    expect(snapshot.findings).toHaveLength(17);
  });

  it("skips a check with no usable id or name rather than inventing one", () => {
    const snapshot = parse("complete", {
      layers: [{
        id: "usability",
        name: "Usability",
        score: 0,
        maxScore: 40,
        checks: [
          { name: "No id", status: "fail", score: 0, maxScore: 1 },
          { id: "no-name", status: "fail", score: 0, maxScore: 1 },
          "not an object",
          { id: "kept", name: "Kept", status: "pass", score: 1, maxScore: 1 },
        ],
      }],
    });
    expect(snapshot.findings.map((finding) => finding.providerCheckId)).toEqual(["kept"]);
  });

  it("truncates provider-controlled prose", () => {
    const snapshot = parse("complete", {
      layers: [{
        id: "usability",
        name: "Usability",
        score: 0,
        maxScore: 40,
        checks: [{
          id: "long",
          name: "Long",
          status: "fail",
          score: 0,
          maxScore: 1,
          details: "d".repeat(5_000),
          recommendation: "r".repeat(5_000),
          naReason: "n".repeat(5_000),
        }],
      }],
    });
    expect(snapshot.findings[0].details).toHaveLength(ORA_MAX_DETAILS_LENGTH);
    expect(snapshot.findings[0].recommendation).toHaveLength(400);
    expect(snapshot.findings[0].applicability).toHaveLength(300);
  });

  it("drops an essentials block that is missing its budgets", () => {
    expect(parse("complete", { essentials: { score: 63, label: "x" } }).essentials).toBeUndefined();
  });
});

describe("Ora HTTP response classification", () => {
  it("treats a 200 with a resolved analysis as a complete result", () => {
    const outcome = classifyOraResponse({ status: 200, body: fixture("complete") });
    expect(outcome).toMatchObject({ kind: "result", complete: true });
    expect(oraAvailabilityFromOutcome(outcome)).toBe("available");
  });

  it("treats a 202 as a usable but unfinished result and exposes the poll URL", () => {
    const outcome = classifyOraResponse({
      status: 202,
      headers: new Headers({ location: "/api/score/example.com" }),
      body: fixture("partial"),
    });
    expect(outcome).toMatchObject({
      kind: "result",
      complete: false,
      pollUrl: "https://ora.ai/api/score/example.com?format=audit&include=essentials",
    });
    expect(oraAvailabilityFromOutcome(outcome)).toBe("pending");
  });

  it("ignores a Location header that points off the provider", () => {
    const outcome = classifyOraResponse({
      status: 202,
      headers: { Location: "https://evil.test/api/score/example.com" },
      body: fixture("partial"),
    });
    expect(outcome).toMatchObject({ kind: "result", complete: false });
    expect("pollUrl" in outcome && outcome.pollUrl).toBeFalsy();
  });

  it("treats a 200 whose analysis is still running as incomplete", () => {
    expect(classifyOraResponse({ status: 200, body: fixture("partial") }))
      .toMatchObject({ kind: "result", complete: false });
    expect(classifyOraResponse({
      status: 200,
      body: { analysisStatus: "complete", pendingChecks: ["openapi-spec"] },
    })).toMatchObject({ kind: "result", complete: false });
  });

  it("recognizes the documented not-scanned envelope", () => {
    const outcome = classifyOraResponse({
      status: 404,
      body: {
        error: "No cached score for this domain",
        code: "DOMAIN_NOT_SCANNED",
        domain: "example.com",
      },
    });
    expect(outcome).toEqual({ kind: "not-scanned", domain: "example.com" });
    expect(oraAvailabilityFromOutcome(outcome)).toBe("not-found");
  });

  it("treats any other 404 as a provider fault, not a missing scan", () => {
    expect(classifyOraResponse({ status: 404, body: { error: "Not found" } }))
      .toMatchObject({ kind: "provider-error", status: 404, retryable: false });
  });

  it("reads Retry-After from the header, then the body", () => {
    const header = classifyOraResponse({
      status: 429,
      headers: new Headers({ "retry-after": "120" }),
      body: { error: "Rate limited", retry_after_ms: 999_000 },
    });
    expect(header).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 120 });
    expect(oraAvailabilityFromOutcome(header)).toBe("rate-limited");

    expect(classifyOraResponse({
      status: 429,
      body: {
        error: "Daily scan limit reached (30 per day). Try again in about 4 hours.",
        retry_after_ms: 14_400_000,
      },
    })).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 14_400 });
  });

  it("accepts an HTTP-date Retry-After", () => {
    expect(oraRetryAfterSeconds(
      { headers: { "Retry-After": "Mon, 24 Aug 2026 06:10:00 GMT" }, body: null },
      Date.parse("2026-08-24T06:00:00.000Z"),
    )).toBe(600);
    expect(oraRetryAfterSeconds({ headers: undefined, body: null })).toBeUndefined();
  });

  it("separates a rejected request from a provider failure", () => {
    const invalid = classifyOraResponse({
      status: 400,
      body: { error: "Invalid domain", code: "INVALID_DOMAIN" },
    });
    expect(invalid).toEqual({ kind: "invalid-request", code: "INVALID_DOMAIN", message: "Invalid domain" });
    expect(oraAvailabilityFromOutcome(invalid)).toBe("error");

    for (const status of [500, 502, 503, 408]) {
      const outcome = classifyOraResponse({ status, body: { error: "Scan failed" } });
      expect(outcome).toMatchObject({ kind: "provider-error", status, retryable: true });
      // A provider failure is never a site failure.
      expect(oraAvailabilityFromOutcome(outcome)).toBe("unavailable");
    }
    expect(classifyOraResponse({ status: 418, body: null }))
      .toMatchObject({ kind: "provider-error", retryable: false });
  });

  it("survives an unreadable body", () => {
    expect(classifyOraResponse({ status: 500, body: null }))
      .toEqual({ kind: "provider-error", status: 500, retryable: true });
    expect(classifyOraResponse({ status: 200, body: "<html>not json</html>" }))
      .toMatchObject({ kind: "result", complete: true });
  });
});

describe("Ora origin key fragment", () => {
  it("is stable per origin and distinct across origins", async () => {
    const first = await oraOriginKeyFragment("https://example.com");
    expect(await oraOriginKeyFragment("https://example.com")).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await oraOriginKeyFragment("https://other.test")).not.toBe(first);
    // Scheme is part of the origin, so it is part of the key.
    expect(await oraOriginKeyFragment("http://example.com")).not.toBe(first);
  });
});
