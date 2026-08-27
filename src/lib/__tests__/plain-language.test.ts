import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { INDUSTRY_TERMS, INTERNAL_TERMS, RULE_ID_SHAPE, appositive } from "../plain-language";

import * as agentChecks from "../agentChecks";
import * as agentCopy from "../agent-copy";
import * as agentIssueCases from "../agentIssueCases";
import * as caseCopy from "../case-copy";
import * as digestCopy from "../digest-copy";
import * as impactFormat from "../impact-format";
import * as labFieldComparison from "../labFieldComparison";
import * as labMetrics from "../labMetrics";
import * as pagesCopy from "../pages-copy";
import * as scoreCardTooltip from "../scoreCardTooltip";
import * as settingsCopy from "../settings-copy";
import * as visitorExperience from "../visitorExperience";
import * as vocabulary from "../vocabulary";
import * as webflowPerformance from "../webflowPerformance";

/**
 * The one pattern, enforced where it can be: plain meaning first, term second.
 *
 * This asserts the ORDERING rather than the punctuation. A string may carry
 * "(cumulative layout shift 0.24)" or not carry it at all; what it may not do is
 * open with the term, because the reader who does not know it then has nothing
 * to read before the thing they cannot read. Checking for a parenthesis would
 * pass "CLS (cumulative layout shift) 0.24", which is the same defect wearing
 * the pattern's clothes.
 *
 * What it does NOT check is "one appositive per term per screen". A screen is
 * not something a test can see — the same string appears on three of them — and
 * the brief is explicit that the second-mention rule is a review call.
 *
 * The corpus is the modules that own copy. That is deliberate rather than
 * convenient: the codebase's rule is that a rendered string belongs to a copy
 * module or a display-label map (rule 20), so anything this test cannot see is
 * a string that should not have been where it is.
 */

const MODULES: Record<string, unknown> = {
  agentChecks,
  agentCopy,
  agentIssueCases,
  caseCopy,
  digestCopy,
  impactFormat,
  labFieldComparison,
  labMetrics,
  pagesCopy,
  scoreCardTooltip,
  settingsCopy,
  visitorExperience,
  vocabulary,
  webflowPerformance,
};

/** Every string reachable from a module's non-function exports, with its path. */
function stringsIn(value: unknown, trail: string, out: { where: string; text: string }[] = []) {
  if (typeof value === "string") {
    if (/[A-Za-z]/.test(value)) out.push({ where: trail, text: value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => stringsIn(item, `${trail}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) stringsIn(item, `${trail}.${key}`, out);
  }
  return out;
}

/**
 * Keys whose values are identifiers rather than copy: enum members, registry
 * keys, route paths, evidence-source keys. They are what the copy is keyed BY.
 */
const IDENTIFIER_KEYS = [
  ".key", ".id", ".psi", ".short", ".value", ".token", ".items[", ".name",
  ".oraChecks", ".localChecks", ".labKey", ".fieldKey", ".relationship",
  ".verdict", ".half", ".scope", ".remediation", ".metric", ".culprit",
  ".actionability", ".source", ".unit", ".tier", ".category",
  "vocabulary.WORK_STATES", "vocabulary.QUEUES", "vocabulary.TONES",
  "vocabulary.ISSUE_ACTIONS", "vocabulary.CHECKPOINT_RESULTS",
  "vocabulary.EVIDENCE_SOURCES", "vocabulary.ACTIONABILITIES",
  "vocabulary.TRENDS", "vocabulary.HEALTHS", "vocabulary.CONFIDENCES",
  "vocabulary.AGENT_RESULTS", "vocabulary.AGENT_VERDICTS",
  "vocabulary.DESTINATIONS", "vocabulary.APPLICABILITIES",
  "vocabulary.APPLICABILITY_ACTIONS", "vocabulary.DESTINATION_PATH",
  "vocabulary.WORK_STATE_QUEUE", "vocabulary.WORK_STATE_TONE",
  "vocabulary.COUNTED_QUEUES", "vocabulary.QUEUE_HOLDS",
  "vocabulary.ISSUE_TRANSITIONS", "vocabulary.APPLICABILITY_TRANSITIONS",
  "vocabulary.ACTIONABILITY_REQUIRES_REASON",
  "agentChecks.AGENT_CHECK_GROUPS", "agentChecks.ALL_AGENT_CHECKS",
  "agentIssueCases.AGENT_ISSUE_FAMILIES.", // family KEYS are ids; titles are read below
  "labFieldComparison.COMPARABLE_METRICS",
  "webflowPerformance.METRIC_PLAIN",
  // The catalogue of upstream audit ids, and the two catalogues kept in step
  // with it. They ARE identifiers; that is the whole point of the lists.
  "webflowPerformance.DOCUMENTED_WEBFLOW_AUDIT_IDS",
  "culpritEvidence.CULPRIT_EVIDENCE",
  "plainLanguage.",
];

/**
 * The term half of a pair whose other half is the plain meaning.
 *
 * `VISITOR_METRICS` carries `label` and `technicalName` precisely so a caller
 * can render the meaning and then the term, and `EVIDENCE_SOURCE_LABEL` names
 * systems rather than measurements — "Lighthouse" is what that tool is called,
 * and no plainer word for it exists. Both are checked by their own tests below
 * rather than by the leading-term rule, which would ask a parenthetical to
 * introduce itself.
 */
const TERM_HALVES = [
  "visitorExperience.VISITOR_METRICS", // .technicalName; .label is the plain half
  "vocabulary.EVIDENCE_SOURCE_LABEL",
  "labMetrics.LAB_METRICS", // .short is the acronym; .label is the plain half
];

/**
 * Prose the registry writes for ITSELF — the evaluation rules and concept
 * notes, which describe the vocabulary to an implementer rather than to a
 * reader. `CHECKPOINT_EVALUATION` is the registry's own text, verbatim.
 */
const REGISTRY_PROSE = [
  "vocabulary.CHECKPOINT_EVALUATION",
  "vocabulary.CHECKPOINT_RESULT_MEANS",
];

const isIdentifier = (where: string) => IDENTIFIER_KEYS.some((key) => where.includes(key));
const isRegistryProse = (where: string) => REGISTRY_PROSE.some((key) => where.startsWith(key));

/** The copy corpus: every reader-facing string these modules state. */
const COPY = Object.entries(MODULES)
  .flatMap(([name, module]) => stringsIn(module, name))
  .filter(({ where }) => !isIdentifier(where) && !isRegistryProse(where))
  // Deduplicate: several maps legitimately share a word.
  .filter((row, index, all) => all.findIndex((other) => other.text === row.text && other.where === row.where) === index);

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does this string OPEN with the term? An article or a possessive in front is
 * still leading with it — "The LCP is 4.1s" tells a reader no more than
 * "LCP 4.1s" does.
 */
function leadsWith(text: string, term: string): boolean {
  return new RegExp(`^(?:the|a|an|your|its|this|these|no|non-)?\\s*${escape(term)}\\b`, "i").test(text.trim());
}

function contains(text: string, term: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_-])${escape(term)}([^A-Za-z0-9_-]|$)`, "i").test(text);
}

describe("the copy corpus", () => {
  it("is large enough that a passing run means something", () => {
    // A guard on the guard. If a refactor moves copy out of these modules, this
    // suite would go quietly green over an empty corpus.
    expect(COPY.length).toBeGreaterThan(150);
  });
});

describe("plain meaning first, term second", () => {
  it("never opens a reader-facing string with an industry term", () => {
    const offenders = COPY
      .filter(({ where }) => !TERM_HALVES.some((prefix) => where.startsWith(prefix)))
      .flatMap(({ where, text }) =>
        INDUSTRY_TERMS.filter((term) => leadsWith(text, term)).map((term) => `${where}: "${text}" leads with "${term}"`));
    expect(offenders).toEqual([]);
  });

  it("puts the plain half of every measurement pair before the term half", () => {
    // These two maps exist so a caller renders meaning-then-term. This asserts
    // the pair is actually in that order — a `technicalName` with no `label`
    // beside it, or a `label` that is itself the acronym, is the defect.
    for (const metric of visitorExperience.VISITOR_METRICS) {
      expect(metric.label, `${metric.key} has no plain half`).toBeTruthy();
      expect(metric.label).not.toBe(metric.technicalName);
      expect(INDUSTRY_TERMS.some((term) => leadsWith(metric.label, term)), `${metric.key}'s label is a term`).toBe(false);
    }
    for (const metric of labMetrics.LAB_METRICS) {
      expect(metric.label, `${metric.key} has no plain half`).toBeTruthy();
      expect(metric.label).not.toBe(metric.short);
      expect(INDUSTRY_TERMS.some((term) => leadsWith(metric.label, term)), `${metric.key}'s label is a term`).toBe(false);
    }
  });

  it("explains every system it names, where the reader can reach it", () => {
    // `EVIDENCE_SOURCE_LABEL` is exempt from the leading-term rule because a
    // system's name is the plain thing to call it. The price of that exemption
    // is this: each one has a line in Settings saying what it contributes, so
    // the name is never the only thing a reader is given. A source added to the
    // ledger fails here rather than appearing unexplained.
    for (const source of vocabulary.EVIDENCE_SOURCES) {
      const line = settingsCopy.SETTINGS_SYSTEM_CONTRIBUTES[source];
      expect(line, `${source} is named but never explained`).toBeTruthy();
      expect(line.length).toBeGreaterThan(40);
    }
  });

  it("builds an introduction with the meaning ahead of the term", () => {
    // The helper is the mechanism, so its own ordering is asserted directly.
    expect(appositive("Content jumps around as this page loads", "cumulative layout shift 0.24"))
      .toBe("Content jumps around as this page loads (cumulative layout shift 0.24)");
    const built = appositive("Responsiveness", "TBT");
    expect(built.indexOf("Responsiveness")).toBeLessThan(built.indexOf("TBT"));
  });
});

describe("internal names never reach a reader", () => {
  it("keeps our own shorthand out of reader-facing copy", () => {
    const offenders = COPY.flatMap(({ where, text }) =>
      INTERNAL_TERMS.filter((term) => contains(text, term)).map((term) => `${where}: "${text}" contains "${term}"`));
    expect(offenders).toEqual([]);
  });

  it("keeps rule ids out of reader-facing copy", () => {
    // A Lighthouse audit id is a key, not a name for a problem. A reader who
    // searches for "uses-optimized-images" reaches Google's documentation
    // rather than their own page.
    const offenders = COPY.flatMap(({ where, text }) =>
      text.split(/[\s,.;:()"']+/)
        .filter((word) => RULE_ID_SHAPE.test(word))
        .map((word) => `${where}: "${text}" contains rule id "${word}"`));
    expect(offenders).toEqual([]);
  });
});

/* ── The glossary is gone, not moved ────────────────────────────────────── */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

const ALL_SOURCE = sourceFiles(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: readFileSync(file, "utf8"),
}));

describe("the glossary retired with its definitions", () => {
  it("has no guide module left to import", () => {
    const importers = ALL_SOURCE.filter(({ text }) => /from\s+["'][^"']*\/guide["']|from\s+["']@\/lib\/guide["']/.test(text));
    expect(importers.map(({ file }) => file)).toEqual([]);
  });

  it("did not relocate the retired terms' definitions", () => {
    // These four are gone from the product. Their glossary entries were the last
    // place they were defined, and a definition of a word nobody uses is worse
    // than no definition: it teaches a reader vocabulary the app will never say
    // back to them. So they went with the file rather than to a new home.
    const retired = ["Verifying", "Acknowledged", "Suppressed", "Action Center"];
    const definitions = ALL_SOURCE.flatMap(({ file, text }) => {
      // A definition, not a mention: the retired word followed by prose saying
      // what it means. Banned words that still appear in titles or toasts are
      // allowlist debts to clear, and are not definitions of the word.
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      return retired
        .filter((term) => new RegExp(`(shortDefinition|appMeaning|term)\\s*:\\s*"[^"]*${term}`).test(stripped))
        .map((term) => `${file} defines "${term}"`);
    });
    expect(definitions).toEqual([]);
  });

  it("sends every retired route to the issues list", () => {
    // /dashboard, /inbox, /tasks, /guide — four redirects, and the fourth is the
    // one that went missing before. Asserting them together means a deleted
    // route fails this test rather than a 404 in production.
    const retired = ["dashboard", "inbox", "tasks", "guide"];
    for (const name of retired) {
      const route = ALL_SOURCE.find(({ file }) => file.endsWith(path.join(name, "page.tsx")));
      expect(route, `the /${name} route must still exist, or old links 404`).toBeDefined();
      // Comments stripped: each route explains why it still exists, and a check
      // that tripped over its own justification would only teach the next editor
      // to delete the paragraph.
      const code = route!.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // Asserts the destination it resolves, not a literal path (rule 21).
      expect(code, `/${name} must redirect via DESTINATION_PATH.issues`).toContain("DESTINATION_PATH.issues");
      expect(code, `/${name} must not aim at a Settings anchor`).not.toContain("#reference");
    }
  });
});
