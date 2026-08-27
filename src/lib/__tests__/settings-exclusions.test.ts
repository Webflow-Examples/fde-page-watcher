import { describe, expect, it } from "vitest";

import { AGENT_CHECK_GROUPS, ALL_AGENT_CHECKS } from "../agentChecks";
import { agentCheckKey, updateAgentIgnoreSettings } from "../agentScoring";
import { NOT_MEASURED } from "../impact-format";
import { excludePage, type IssueCase } from "../issue-case";
import { pendingPage } from "../mutations";
import { detectNativeWebflowElements } from "../nativeElements";
import { excludedFromResults } from "../settings-exclusions";
import type { AppState, Night, WatchPage } from "../types";
import {
  AGENT_RESULT_LABEL,
  APPLICABILITY_ACTION_LABEL,
  UNLABELLED_EXCLUSION_REASON,
  applicabilityActionLabel,
} from "../vocabulary";

/**
 * The one list, and the promise every row in it makes.
 *
 * "Excluding is not deleting" is the registry's sentence and this is where it
 * is enforced: a row that lost its reading would say the thing was never
 * measured, and a row that lost its reason would be the agent tab's original
 * failure — evidence hidden without saying why — rebuilt on a settings screen.
 *
 * Rule 18 has a second job here. A row with no reading says so in words rather
 * than showing 0, because an absent measurement is not a small one, and a
 * settings screen is the easiest place in a product to let a blank cell read as
 * a zero.
 */

const AT = "2026-08-04T06:00:00.000Z";
const FINDING_ID = "webflow-background-video";

/**
 * A real detection rather than a posed one.
 *
 * The finding is produced by `detectNativeWebflowElements` from markup, so the
 * title and the count under test are the ones a scan actually writes. A
 * hand-built finding would assert this module against a fixture's spelling of a
 * reading instead of against the reading (rule 21).
 */
const SCANNED = detectNativeWebflowElements(
  `<!doctype html><html><body>
    <div class="hero w-background-video" data-video-urls="hero.mp4"></div>
    <div class="panel w-background-video" data-video-urls="panel.mp4"></div>
    <div class="foot w-background-video" data-video-urls="foot.mp4"></div>
  </body></html>`,
);
const BACKGROUND_VIDEO = SCANNED.find((finding) => finding.id === FINDING_ID)!;

const SCORES = { m: 90, lo: 89, hi: 91 };

function nightWith(): Night {
  const night: Night = {
    i: 0,
    date: "Aug 4",
    iso: AT,
    scores: {
      mobile: { perf: SCORES, a11y: SCORES, bp: SCORES, seo: SCORES },
      desktop: { perf: SCORES, a11y: SCORES, bp: SCORES, seo: SCORES },
    },
    nativeElements: { status: "available", findings: SCANNED },
  };
  return night;
}

function pageWith(overrides: Partial<WatchPage> = {}): WatchPage {
  return { ...pendingPage("home", "Home", "https://example.com/", "watching"), ...overrides };
}

const FIRST_CHECK = ALL_AGENT_CHECKS[0]!;
const FIRST_GROUP = AGENT_CHECK_GROUPS[0]!;

describe("everything this site has set aside", () => {
  it("keeps an excluded finding's last reading and its reason", () => {
    const state: AppState = {
      pages: [pageWith({
        history: [nightWith()],
        nativeElementControls: {
          [FINDING_ID]: { excluded: { reason: "Intentional" }, updatedAt: AT },
        },
      })],
      recs: [],
    };

    const [row] = excludedFromResults(state);
    expect(row.kind).toBe("check");
    expect(row.title).toBe(BACKGROUND_VIDEO.title);
    // Scoped to the page it was excluded on, so "why am I not seeing this" has
    // an answer that names a place as well as a reason.
    expect(row.scope).toBe("Home");
    expect(row.reason).toBe("Intentional");
    // The count the scan recorded, not a number this test chose.
    expect(BACKGROUND_VIDEO.count).toBe(3);
    expect(row.reading).toBe(`${BACKGROUND_VIDEO.count} instances`);
    expect(row.measured).toBe(true);
    expect(row.include).toEqual({ target: "native-element", pageId: "home", findingId: FINDING_ID });
  });

  it("says a row has no reading rather than showing it as none", () => {
    // Rule 18. Excluded before any scan ever saw it: there is no count, and a
    // blank cell or a 0 would both read as "we looked and found nothing".
    const state: AppState = {
      pages: [pageWith({
        nativeElementControls: {
          [FINDING_ID]: { excluded: { reason: "Accepted risk" }, updatedAt: AT },
        },
      })],
      recs: [],
    };

    const [row] = excludedFromResults(state);
    expect(row.reading).toBe(NOT_MEASURED);
    expect(row.measured).toBe(false);
  });

  it("reports the reason this reader chose, when they were asked for one", () => {
    // S8's Excluded list asks; the toggle it replaced did not. A record written
    // by the new control carries its own reason rather than the migrated one.
    const state: AppState = {
      pages: [pageWith()],
      recs: [],
      agentIgnoreDefaults: updateAgentIgnoreSettings(
        { checks: [], groups: [] },
        "group",
        FIRST_GROUP.name,
        true,
        "Accepted risk",
      ),
    };

    const [row] = excludedFromResults(state);
    expect(row.reason).toBe("Accepted risk");

    // And Include drops it: a reason for something that is counted again is not
    // a reason, and keeping it would let a later exclusion silently reinstate a
    // decision nobody made the second time.
    const included = updateAgentIgnoreSettings(state.agentIgnoreDefaults, "group", FIRST_GROUP.name, false);
    expect(included.reasons).toBeUndefined();
  });

  it("reports a check's worst reading across the site, never a tally", () => {
    /**
     * Rule 19: the figure standing for several pages is the worst reading one
     * of them produced. A check that failed on one page reads Failed here even
     * where it passed on another, so the row can be reconciled with the pages
     * beneath it rather than being an average nobody can click through to.
     */
    const state: AppState = {
      pages: [
        pageWith({ id: "home", agent: [{ ...FIRST_CHECK, pass: true }] }),
        pageWith({ id: "pricing", title: "Pricing", agent: [{ ...FIRST_CHECK, pass: false }] }),
      ],
      recs: [],
      agentIgnoreDefaults: { checks: [agentCheckKey(FIRST_CHECK)], groups: [] },
    };

    const [row] = excludedFromResults(state);
    expect(row.title).toBe(FIRST_CHECK.name);
    expect(row.reading).toBe(AGENT_RESULT_LABEL.failed);
    // The toggle that set this never asked for a reason, so it carries the one
    // that restates its own definition rather than none at all.
    expect(row.reason).toBe(UNLABELLED_EXCLUSION_REASON);
  });

  it("does not list a check twice when its whole category is excluded", () => {
    // Two rows for one exclusion would make Include ambiguous: including the
    // check would leave the category's exclusion in place and look broken.
    const inGroup = ALL_AGENT_CHECKS.find((check) => check.group === FIRST_GROUP.name)!;
    const state: AppState = {
      pages: [pageWith()],
      recs: [],
      agentIgnoreDefaults: { checks: [agentCheckKey(inGroup)], groups: [FIRST_GROUP.name] },
    };

    const rows = excludedFromResults(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].include).toEqual({ target: "agent-check", scope: "group", value: FIRST_GROUP.name });
  });

  it("covers pages as well as checks, in one list", () => {
    const issue = {
      id: "PW-1",
      cause: "c",
      state: "new",
      title: "Unused JavaScript",
      diagnosis: "The homepage ships a bundle nothing on it uses.",
      detectedAt: AT,
      confirmedRuns: 2,
      scope: "pages",
      pageIds: ["home", "pricing"],
      strategies: ["mobile"],
      impactMs: 1_800,
      effort: "hours",
      confidence: "confirmed",
      remediation: { steps: ["Remove it."], actionability: "direct" },
      successCriteria: "Gone.",
      checkpoints: [],
      evidence: [],
      history: [],
    } as unknown as IssueCase;
    const excluded = excludePage(issue, "pricing", "Not applicable to this site", {
      // Who excluded it, named. The registry's `actor` is a permission set; this
      // is the record of who did (F4).
      by: { kind: "person", userId: "rae@webflow.com" },
      at: AT,
      page: "Pricing",
    });

    const state: AppState = {
      pages: [pageWith(), pageWith({ id: "pricing", title: "Pricing" })],
      recs: [],
    };

    const rows = excludedFromResults(state, [excluded]);
    const page = rows.find((row) => row.kind === "page")!;
    // The row carries the case, not a key. The decision log is keyed on the
    // remediation and `remediationKey` is its single producer, so a row that
    // carried a precomputed key would put a second one in circulation — the
    // detachment F5's guard exists to catch.
    expect(page.include).toEqual({ target: "case-page", issue: excluded, pageId: "pricing" });
    expect(page.title).toBe("Pricing");
    expect(page.scope).toBe("Unused JavaScript");
    expect(page.reason).toBe("Not applicable to this site");
    // The reading survives the exclusion. Struck through on screen says "not
    // counted"; removing it would say "never measured".
    expect(page.reading).toBe("1.8 s");
    expect(page.measured).toBe(true);
  });

  it("puts pages before checks and never orders either by importance", () => {
    /**
     * An exclusion has no rank — the reader already decided each of these does
     * not apply. Sorting by cost or severity would be the product arguing with
     * a decision it was told about, so the order is kind then name.
     */
    const state: AppState = {
      pages: [pageWith({
        history: [nightWith()],
        nativeElementControls: {
          [FINDING_ID]: { excluded: { reason: "Intentional" }, updatedAt: AT },
        },
      })],
      recs: [],
      agentIgnoreDefaults: { checks: [], groups: [FIRST_GROUP.name] },
    };

    const rows = excludedFromResults(state);
    expect(rows.every((row) => row.kind === "check")).toBe(true);
    expect(rows.map((row) => row.title)).toEqual([...rows.map((row) => row.title)].sort((a, b) => a.localeCompare(b)));
  });

  it("offers the registry's word for putting something back", () => {
    // Rule 20: the button reads "Include" because the registry says so, not
    // because this screen or the case detail each decided to spell it that way.
    expect(applicabilityActionLabel("excluded")).toBe(APPLICABILITY_ACTION_LABEL.include);
  });

  it("is empty when nothing has been set aside", () => {
    expect(excludedFromResults({ pages: [pageWith()], recs: [] })).toEqual([]);
  });
});
