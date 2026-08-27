import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentAccess,
  agentAgreement,
  agentReadings,
  AGENT_ACCESS_SOURCES,
  AGENT_ACCESS_SOURCE_OMISSIONS,
  AGENT_RESULT_FOR_STATUS,
  ALL_EVIDENCE_SOURCES,
  EVIDENCE_SOURCE_FOR_AGENT_SYSTEM,
  type AgentAccess,
} from "../agent-access";
import {
  agentExcluded,
  agentReadingsAgree,
  agentReadingsConflict,
  agentReadingsCount,
  AGENT_CAUSE,
  AGENT_LAST_CHECKED,
  AGENT_NEXT_ACTION,
  AGENT_READINGS_LABEL,
  AGENT_TITLE,
  AGENT_UNKNOWN,
} from "../agent-copy";
import { assembleAgentIssueCases } from "../agentIssueCases";
import {
  AGENT_RESULTS,
  AGENT_RESULT_LABEL,
  AGENT_VERDICTS,
  AGENT_VERDICT_LABEL,
  DESTINATION_PATH,
  EVIDENCE_SOURCE_LABEL,
  EXCLUSION_REASONS,
} from "../vocabulary";
import { caseHref } from "../../components/issue-row";
import { ALL_AGENT_CHECKS } from "../agentChecks";
import type { ExternalAgentFinding, ExternalAgentOriginAudit } from "../agentAudit";
import type { AgentCheck, KitesurfEvidence, NativeElementScan } from "../types";

/**
 * S4 — Agent access.
 *
 * These assert the decision, not the code: the source list is checked against
 * the registry's evidence slots, the result and verdict words are checked
 * against the registry's maps, and the verdict is checked against the readings
 * it claims to rest on. Nothing here asserts a literal that `vocabulary.json`
 * also names, because that proves two copies agree and never that either is
 * right (registry rule 21).
 */

const ORA_AT = "2026-08-24T04:00:00.000Z";
const CHECKS_AT = "2026-08-24T05:40:00.000Z";
const PROBE_AT = "2026-08-24T02:00:00.000Z";
const SCAN_AT = "2026-08-23T01:00:00.000Z";
const LIGHTHOUSE_AT = "2026-08-22T01:00:00.000Z";

function check(name: string, pass: boolean, extra: Partial<AgentCheck> = {}): AgentCheck {
  const known = ALL_AGENT_CHECKS.find((item) => item.name === name);
  return { name, group: known?.group ?? "Discoverability", pass, ...extra };
}

function finding(
  providerCheckId: string,
  result: ExternalAgentFinding["result"],
  extra: Partial<ExternalAgentFinding> = {},
): ExternalAgentFinding {
  return {
    provider: "ora",
    providerCheckId,
    name: providerCheckId,
    tier: "essential",
    result,
    providerStatus: result,
    ...extra,
  };
}

function audit(findings: ExternalAgentFinding[]): ExternalAgentOriginAudit {
  return {
    provider: "ora",
    origin: "https://example.com",
    status: {
      provider: "ora",
      origin: "https://example.com",
      status: "available",
      lastAttemptedAt: ORA_AT,
    },
    snapshots: [{
      schemaVersion: 1,
      provider: "ora",
      origin: "https://example.com",
      target: "https://example.com",
      status: "available",
      scannedAt: ORA_AT,
      fetchedAt: ORA_AT,
      score: 61,
      findings,
      rawReportKey: "k",
    }],
  };
}

function probe(status: "available" | "unavailable", httpStatus?: number): KitesurfEvidence {
  return {
    schemaVersion: 1,
    engine: "kitesurf",
    status,
    capturedAt: PROBE_AT,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

const scan = (overrides: Partial<NativeElementScan> = {}): NativeElementScan => ({
  status: "available",
  findings: [],
  platform: { name: "webflow", confidence: "high", signals: ["data-wf-site"] },
  ...overrides,
});

function accessFor(
  input: Parameters<typeof assembleAgentIssueCases>[0],
  extra: Omit<Parameters<typeof agentAccess>[0], "cases"> = {},
): AgentAccess {
  return agentAccess({ cases: assembleAgentIssueCases(input), ...extra });
}

const rowFor = (access: AgentAccess, source: string) => {
  const found = access.readings.find((reading) => reading.source === source);
  if (!found) throw new Error(`no reading row for ${source}`);
  return found;
};

/* ── The sources ────────────────────────────────────────────────────────── */

describe("the readings table", () => {
  it("has one row per source and no aggregate row", () => {
    const access = accessFor({ checks: [check("Sitemap", true)] });
    expect(access.readings).toHaveLength(AGENT_ACCESS_SOURCES.length);
    expect(access.readings.map((reading) => reading.source)).toEqual([...AGENT_ACCESS_SOURCES]);
  });

  it("draws its five sources from the registry's slots, omitting only CrUX", () => {
    // Not a hand-copied list: the five plus the stated omission must be exactly
    // the registry's evidence_source concept.
    const covered = [...AGENT_ACCESS_SOURCES, ...AGENT_ACCESS_SOURCE_OMISSIONS].sort();
    expect(covered).toEqual([...ALL_EVIDENCE_SOURCES].sort());
    expect(AGENT_ACCESS_SOURCE_OMISSIONS).toEqual(["crux"]);
  });

  it("gives Ora its own row, distinct from the agent-readiness checks", () => {
    const access = accessFor({
      checks: [check("Sitemap", true)],
      checksObservedAt: CHECKS_AT,
      audit: audit([finding("bot-detection", "failed")]),
    });
    const readiness = rowFor(access, "agent-readiness");
    const ora = rowFor(access, "ora");
    expect(readiness.source).not.toBe(ora.source);
    // Each keeps its own date, so one system's freshness never speaks for another.
    expect(readiness.observedAt).toBe(CHECKS_AT);
    expect(ora.observedAt).toBe(ORA_AT);
    expect(EVIDENCE_SOURCE_LABEL[readiness.source]).not.toBe(EVIDENCE_SOURCE_LABEL[ora.source]);
  });

  it("carries the source's own words, not Page Watch's", () => {
    const access = accessFor({
      checks: [check("Sitemap", false)],
      checksObservedAt: CHECKS_AT,
      audit: audit([finding("bot-detection", "failed", { details: "Challenged with a CAPTCHA" })]),
    });
    expect(rowFor(access, "agent-readiness").words).toContain("Sitemap");
    expect(rowFor(access, "ora").words).toContain("Challenged with a CAPTCHA");
  });

  it("says Unavailable rather than passing when a source took no reading", () => {
    // Rule 18: an absent measurement is never folded in as though it were good.
    const access = accessFor({ checks: [] });
    for (const source of AGENT_ACCESS_SOURCES) {
      expect(rowFor(access, source).result).toBe("unavailable");
      expect(rowFor(access, source).words).toBeUndefined();
    }
  });

  it("uses only registry result words", () => {
    const access = accessFor({
      checks: [check("Sitemap", false)],
      audit: audit([finding("x402-support", "not-applicable")]),
      kitesurf: probe("available", 200),
    }, { nativeElements: { scan: scan() } });
    for (const reading of access.readings) {
      expect([...AGENT_RESULTS]).toContain(reading.result);
    }
  });

  it("maps every assembler status onto a registry result word", () => {
    // The two spellings meet in exactly one place, and it covers the union.
    expect(new Set(Object.values(AGENT_RESULT_FOR_STATUS)).size).toBeGreaterThan(0);
    for (const result of Object.values(AGENT_RESULT_FOR_STATUS)) {
      expect([...AGENT_RESULTS]).toContain(result);
    }
    expect(AGENT_RESULT_FOR_STATUS.pass).toBe("passed");
    expect(AGENT_RESULT_FOR_STATUS["not-applicable"]).toBe("not_applicable");
  });

  it("shows one source's worst reading, never two sources combined", () => {
    const access = accessFor({
      checks: [check("Sitemap", true), check("Markdown negotiation", false)],
      checksObservedAt: CHECKS_AT,
    });
    const readiness = rowFor(access, "agent-readiness");
    // The worst of Page Watch's own readings, with the check that produced it.
    expect(readiness.result).toBe("failed");
    expect(readiness.words).toBe("Markdown negotiation");
    // And the passing check is not averaged into it, nor lost: Ora's row is
    // untouched, and the reading is still on its case underneath.
    expect(rowFor(access, "ora").result).toBe("unavailable");
  });
});

describe("the published-HTML scan and Lighthouse", () => {
  it("reads the scan as reach, with the scan's own date", () => {
    const access = accessFor({ checks: [] }, {
      nativeElements: { scan: scan(), observedAt: SCAN_AT },
    });
    const row = rowFor(access, "native-elements");
    expect(row.result).toBe("passed");
    expect(row.observedAt).toBe(SCAN_AT);
  });

  it("keeps the scan's own reason when it could not run", () => {
    const access = accessFor({ checks: [] }, {
      nativeElements: {
        scan: scan({ status: "unavailable", reason: "published page could not be inspected" }),
        observedAt: SCAN_AT,
      },
    });
    const row = rowFor(access, "native-elements");
    expect(row.result).toBe("unavailable");
    expect(row.words).toBe("published page could not be inspected");
  });

  it("says Lighthouse does not apply rather than turning its score into a verdict", () => {
    const access = accessFor({ checks: [] }, { lighthouse: { observedAt: LIGHTHOUSE_AT } });
    const row = rowFor(access, "lighthouse");
    expect(row.result).toBe("not_applicable");
    expect(row.observedAt).toBe(LIGHTHOUSE_AT);
    // The row exists so a reader can see Lighthouse was not folded in.
    expect(row.words).toBeUndefined();
  });
});

/* ── Exclusion ──────────────────────────────────────────────────────────── */


describe("a source excluded from the table", () => {
  const excludedAccess = () => accessFor({
    checks: [check("Sitemap", false)],
    checksObservedAt: CHECKS_AT,
  }, { excluded: { "agent-readiness": "Not applicable to this site" } });

  it("keeps its row, its last reading and its date", () => {
    const row = rowFor(excludedAccess(), "agent-readiness");
    expect(row.applicability).toBe("excluded");
    expect(row.result).toBe("failed");
    expect(row.words).toBe("Sitemap");
    expect(row.observedAt).toBe(CHECKS_AT);
  });

  it("says why, in a reason the registry blesses", () => {
    const row = rowFor(excludedAccess(), "agent-readiness");
    if (row.applicability !== "excluded") throw new Error("expected an excluded row");
    expect([...EXCLUSION_REASONS]).toContain(row.reason);
    expect(agentExcluded(row.reason)).toContain(row.reason);
  });

  it("stops counting toward the last-checked date", () => {
    // Excluding is not deleting: the reading is still shown, it just no longer
    // speaks for when this origin was last looked at.
    expect(excludedAccess().lastChecked).toBeUndefined();
  });

  it("leaves every other row included", () => {
    const rows = agentReadings({ cases: [], excluded: { lighthouse: "Intentional" } });
    expect(rows.filter((row) => row.applicability === "excluded").map((row) => row.source))
      .toEqual(["lighthouse"]);
  });
});

describe("S4 resolves no exclusion reason of its own", () => {
  it("leaves the narrowing to the module that owns the record", () => {
    // S8 owns exclusions end to end and `settings-exclusions.ts` already turns a
    // stored string into a decided reason for the agent-check record. A second
    // resolver here would be a second opinion about what a valid reason is, and
    // the two disagree the day the registry changes. This module takes reasons
    // already narrowed and renders them.
    const agentAccessSource = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-access.ts"),
      "utf8",
    );
    expect(agentAccessSource).not.toContain("EXCLUSION_REASONS");
    expect(agentAccessSource).not.toMatch(/\.reasons\b/);
  });

  it("keeps types.ts importing nothing, so the registry cannot reach the stored shape", () => {
    // The property the whole arrangement rests on: the persisted shape cannot
    // name a registry type, so a reason is a plain string there and is narrowed
    // by whichever module owns that record.
    const types = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "types.ts"),
      "utf8",
    );
    expect([...types.matchAll(/(?:^|\n)\s*import[^;]*?from\s*["']([^"']+)["']/g)]).toEqual([]);
    const declarations = types
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
      .join("\n");
    expect(declarations).not.toContain("ExclusionReason");
  });
});

/* ── The verdict ─────────────────────────────────────────────────────── */

describe("one verdict per origin", () => {
  it("only ever produces a registry verdict key", () => {
    const cases = [
      accessFor({ checks: [] }),
      accessFor({ checks: [check("Sitemap", true)] }),
      accessFor({ checks: [check("Sitemap", false)] }),
      accessFor({ checks: [], audit: audit([finding("openapi-spec", "failed")]) }),
    ];
    for (const access of cases) {
      expect([...AGENT_VERDICTS]).toContain(access.verdict);
    }
  });

  it("is Blocked when an essential check is settled and failing", () => {
    const access = accessFor({
      checks: [check("API Catalog", false)],
      checksObservedAt: CHECKS_AT,
      audit: audit([finding("openapi-spec", "failed", { tier: "essential" })]),
    });
    expect(access.verdict).toBe("blocked");
    if (access.verdict !== "blocked") return;
    expect(access.primary.key).toBe("agent-api:openapi");
    expect(access.fault).toBe("comprehension");
  });

  it("is Needs work when nothing essential is failing", () => {
    const access = accessFor({
      checks: [],
      audit: audit([finding("rate-limit-headers", "failed", { tier: "recommended" })]),
    });
    expect(access.verdict).toBe("needs_work");
    expect(AGENT_VERDICT_LABEL[access.verdict]).toBe("Needs work");
  });

  it("treats a partial essential finding as Needs work, not a block", () => {
    const access = accessFor({
      checks: [],
      audit: audit([finding("content-no-js", "partial", { tier: "essential" })]),
    });
    expect(access.verdict).toBe("needs_work");
  });

  it("is Ready when everything determined is passing", () => {
    const access = accessFor({
      checks: [check("Sitemap", true)],
      checksObservedAt: CHECKS_AT,
      audit: audit([finding("sitemap", "pass"), finding("x402-support", "not-applicable")]),
    });
    expect(access.verdict).toBe("ready");
    expect(access.primary).toBeNull();
  });

  it("never renders a verdict without a date to put beside it", () => {
    const dated = accessFor({ checks: [check("Sitemap", true)], checksObservedAt: CHECKS_AT });
    expect(dated.lastChecked).toBe(CHECKS_AT);
    // And where there is genuinely no date, the verdict is the one that says
    // nothing was read — never a conclusion floating free of a reading.
    const undated = accessFor({ checks: [] });
    expect(undated.verdict).toBe("unknown");
    expect(undated.lastChecked).toBeUndefined();
  });

  it("takes the newest included date, never a source's date for another source", () => {
    const access = accessFor({
      checks: [check("Sitemap", true)],
      checksObservedAt: CHECKS_AT,
      audit: audit([finding("sitemap", "pass")]),
      kitesurf: probe("available", 200),
    });
    expect(access.lastChecked).toBe(CHECKS_AT);
    expect(rowFor(access, "ora").observedAt).toBe(ORA_AT);
    expect(rowFor(access, "kitesurf").observedAt).toBe(PROBE_AT);
  });
});

describe("Unknown, and which of its two causes", () => {
  it("says nothing was read when nothing was", () => {
    const access = accessFor({ checks: [check("Sitemap", true, { unavailable: true })] });
    expect(access.verdict).toBe("unknown");
    if (access.verdict !== "unknown") return;
    expect(access.cause).toBe("no_reading");
  });

  it("is Unknown when two systems disagree about reaching the origin", () => {
    // Kitesurf got a 200 from the origin; Ora says bot management refused it.
    const access = accessFor({
      checks: [],
      audit: audit([finding("bot-detection", "failed")]),
      kitesurf: probe("available", 200),
    });
    expect(access.verdict).toBe("unknown");
    if (access.verdict !== "unknown" || access.cause !== "disagree") {
      throw new Error(`expected a disagreement, got ${JSON.stringify(access)}`);
    }
    expect(access.cause).toBe("disagree");
  });

  it("shows both conflicting readings, adjacent, with their own results", () => {
    const access = accessFor({
      checks: [],
      audit: audit([finding("bot-detection", "failed")]),
      kitesurf: probe("available", 200),
    });
    if (access.verdict !== "unknown" || access.cause !== "disagree") {
      throw new Error("expected a disagreement");
    }
    const [negative, positive] = access.disagreement;
    expect([negative.source, positive.source].sort()).toEqual(["kitesurf", "ora"]);
    expect(negative.result).toBe("failed");
    expect(positive.result).toBe("passed");
    // Both are rows of the same table, so nothing is shown that the reader
    // cannot also find below.
    expect(access.readings).toContain(negative);
    expect(access.readings).toContain(positive);
  });

  it("distinguishes the two causes in the copy, never collapsing them", () => {
    expect(AGENT_UNKNOWN.disagree).not.toBe(AGENT_UNKNOWN.no_reading);
  });

  it("does not let a disagreement swallow a measured essential failure", () => {
    // Rule 18: a claim withheld for want of data must not hide a drop that was
    // measured. Reach is in doubt, but the OpenAPI failure is not.
    const access = accessFor({
      checks: [],
      audit: audit([
        finding("bot-detection", "failed"),
        finding("openapi-spec", "failed", { tier: "essential" }),
      ]),
      kitesurf: probe("available", 200),
    });
    expect(access.verdict).toBe("blocked");
  });
});

describe("the subline", () => {
  it("names exactly one half on a needs_work verdict", () => {
    const reach = accessFor({
      checks: [],
      audit: audit([finding("rate-limit-headers", "failed", { tier: "recommended" })]),
    });
    expect(reach.verdict).toBe("needs_work");
    if (reach.verdict !== "needs_work") return;
    expect(AGENT_CAUSE[reach.fault]).toBe(AGENT_CAUSE.reach);
    expect(AGENT_CAUSE[reach.fault]).not.toBe(AGENT_CAUSE.comprehension);

    const comprehension = accessFor({
      checks: [],
      audit: audit([finding("json-error-responses", "failed", { tier: "recommended" })]),
    });
    if (comprehension.verdict !== "needs_work") throw new Error("expected needs_work");
    expect(comprehension.fault).toBe("comprehension");
  });

  it("keeps the two halves as sentences, never as a second verdict", () => {
    // The deferred split would have been a second verdict word. It is two
    // sentences under one verdict instead, and neither is a registry key.
    for (const sentence of Object.values(AGENT_CAUSE)) {
      expect([...AGENT_VERDICTS]).not.toContain(sentence);
      expect(Object.values(AGENT_VERDICT_LABEL)).not.toContain(sentence);
    }
  });
});

/* ── The copy ───────────────────────────────────────────────────────────── */

describe("the words", () => {
  it("takes its result and verdict words from the registry, never a second copy", () => {
    expect(agentReadingsAgree(3, "passed", "ready"))
      .toBe(`3 ${AGENT_RESULT_LABEL.passed} readings and no disagreement, so the verdict is ${AGENT_VERDICT_LABEL.ready}.`);
    expect(agentReadingsConflict("Ora", "Kitesurf"))
      .toBe(`Ora and Kitesurf disagree, so the verdict is ${AGENT_VERDICT_LABEL.unknown}. Both readings are above.`);
  });

  it("never says a retired result word", () => {
    const registryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../vocabulary.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
      concepts: Record<string, { banned_as_label: string[] }>;
    };
    const sentences = [
      AGENT_TITLE,
      ...Object.values(AGENT_CAUSE),
      ...Object.values(AGENT_UNKNOWN),
      agentReadingsCount(AGENT_ACCESS_SOURCES.length),
      agentReadingsAgree(3, "passed", "ready"),
      agentReadingsConflict("Ora", "Kitesurf"),
      agentExcluded("Accepted risk"),
    ].join(" ");
    for (const banned of registry.concepts.agent_result.banned_as_label) {
      expect(sentences, `"${banned}" is retired for a result`).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
    for (const banned of registry.concepts.agent_verdict.banned_as_label) {
      expect(sentences, `"${banned}" is retired for a verdict`).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
  });

  it("counts the sources it actually shows", () => {
    expect(agentReadingsCount(AGENT_ACCESS_SOURCES.length))
      .toBe(`${AGENT_ACCESS_SOURCES.length} sources · never averaged`);
  });

  it("says the locked strings, verbatim", () => {
    // These are not registry words, so asserting them here is asserting the
    // decision rather than one copy against another.
    //
    // Three of them were re-decided in S9 and the lock moved with the decision.
    // They said "origin" and "parse" — our word for a site, and what a program
    // does to a document — so the sentences named the fault in vocabulary that
    // concealed it. What they distinguish is untouched: got in, versus got in
    // and could not read.
    expect(AGENT_TITLE).toBe("Agent access");
    expect(AGENT_CAUSE.reach).toBe("Agents cannot reach this site at all.");
    expect(AGENT_CAUSE.comprehension).toBe("Agents reach the site but cannot read what is on it.");
    expect(AGENT_UNKNOWN.disagree)
      .toBe("Two systems disagree about whether agents can reach this site.");
    expect(AGENT_UNKNOWN.no_reading)
      .toBe("No reading could be taken, so there is nothing to conclude yet.");
    expect(AGENT_LAST_CHECKED).toBe("Last checked");
    expect(AGENT_NEXT_ACTION).toBe("Next action");
    expect(AGENT_READINGS_LABEL).toBe("Every reading");
    expect(agentExcluded("Intentional")).toBe("Excluded — Intentional. Last reading kept.");
  });
});

/* ── The case link ──────────────────────────────────────────────────────── */

describe("the link to the case", () => {
  it("resolves to /issues/{id}", () => {
    expect(caseHref("", "home:agent-issue:agent-api:openapi"))
      .toBe(`${DESTINATION_PATH.issues}/${encodeURIComponent("home:agent-issue:agent-api:openapi")}`);
    expect(caseHref("/app", "c1")).toBe(`/app${DESTINATION_PATH.issues}/c1`);
  });

  it("has no /issues/case/ route to point at", () => {
    const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else routes.push(path.relative(app, path.join(dir, entry.name)));
      }
    };
    walk(app);
    expect(routes.filter((route) => route.includes("issues/case"))).toEqual([]);
    // And the one the link does use exists.
    expect(routes).toContain(path.join("(app)", "issues", "[id]", "page.tsx"));
  });
});

/* ── No arithmetic across sources ───────────────────────────────────────── */

describe("nothing is averaged", () => {
  it("reports a count of rows that the table can be checked against", () => {
    const access = accessFor({
      checks: [check("Sitemap", true)],
      checksObservedAt: CHECKS_AT,
      audit: audit([finding("sitemap", "pass")]),
      kitesurf: probe("available", 200),
    });
    const agreement = agentAgreement(access);
    const matching = access.readings.filter((reading) =>
      reading.applicability === "included" && reading.result === agreement.result);
    expect(agreement.count).toBe(matching.length);
    expect([...AGENT_RESULTS]).toContain(agreement.result);
  });

  it("divides nothing by a count of sources, anywhere under src/", () => {
    // The rule this screen exists to keep, asserted against the tree rather
    // than promised in a comment. The shape looked for is the arithmetic
    // itself: a total divided by how many readings went into it. A median
    // across repeated runs of ONE system is a different thing and is left
    // alone — `psiCore` needs it, and rule 19 is about combining sources.
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(src);
    expect(files.length).toBeGreaterThan(50);

    const divided = /\/\s*(?:sources|readings|systems|findings|evidence|cases)(?:\.length|\.size)\b/;
    for (const file of files) {
      const where = path.relative(src, file);
      expect(readFileSync(file, "utf8"), `${where} divides a total by a source count`)
        .not.toMatch(divided);
    }
  });

  it("performs no division at all in the modules that produce the verdict", () => {
    // Narrower and stricter than the sweep above: the three modules behind the
    // verdict and its rows contain no division operator in executable code, so
    // there is nowhere for a percentage or a composite to be introduced without
    // this failing. Comment lines are stripped first — the prose is allowed to
    // say what the code may not do.
    const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    for (const file of ["agent-access.ts", "agent-copy.ts", "agentIssueCases.ts"]) {
      const code = readFileSync(path.join(lib, file), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .join("\n");
      expect(code, `${file} divides something`).not.toMatch(/[^/*\n]\s\/\s[^/*\n]/);
      expect(code, `${file} accumulates a total`).not.toMatch(/\+=/);
    }
  });
});

/* ── A verdict is never shown without its date ──────────────────────────── */

describe("the verdict and its date", () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const componentsOf = (): string[] => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx")) found.push(full);
      }
    };
    walk(src);
    return found;
  };

  it("paints the verdict word in exactly one component", () => {
    const painting = componentsOf().filter((file) =>
      readFileSync(file, "utf8").includes("AGENT_VERDICT_LABEL"));
    expect(painting.map((file) => path.relative(src, file)))
      .toEqual([path.join("components", "agent-access.tsx")]);
  });

  it("makes the date an argument of that component rather than a line beside it", () => {
    // The guarantee is structural: the one place that renders the word takes
    // the date in the same call, and the prop is required. An optional date
    // would let a caller render a claim with nothing behind it, so its absence
    // is what this asserts.
    const component = readFileSync(path.join(src, "components", "agent-access.tsx"), "utf8");
    expect(component.match(/AGENT_VERDICT_LABEL\[/g) ?? []).toHaveLength(1);
    expect(component).toContain("lastChecked: string | undefined");
    expect(component, "an optional last-checked date breaks the guarantee")
      .not.toMatch(/lastChecked\?:/);
    expect(component).toContain("AGENT_LAST_CHECKED");
  });
});

/* ── The mapping between a system and its row ───────────────────────────── */

describe("systems and slots", () => {
  it("routes each assembler system to a row that exists in the table", () => {
    for (const slot of Object.values(EVIDENCE_SOURCE_FOR_AGENT_SYSTEM)) {
      expect([...AGENT_ACCESS_SOURCES]).toContain(slot);
    }
  });
});
