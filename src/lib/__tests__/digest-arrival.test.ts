import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DIGEST_DATE_PARAM,
  DIGEST_LINE_PARAM,
  DIGEST_SECTIONS,
  buildDigest,
  digestArrivalQuery,
  digestLineFor,
  parseDigestArrival,
} from "../digest";
import { absoluteUrl, caseHref, casePath } from "../paths";
import {
  accept,
  markFixed,
  personActionsFor,
  primaryActionFor,
  start,
  type IssueCase,
  type IssueState,
} from "../issue-case";
import type { Caller } from "../caller";
import { recordCheckpointReading } from "../checkpoint-evaluation";
import { normalizePerformanceThresholds } from "../performanceThresholds";
import { ISSUE_TRANSITIONS, QUEUES, WORK_STATES, type IssueAction } from "../vocabulary";
import { pendingPage } from "../mutations";

/**
 * Arrival: what happens when someone follows a line in the digest.
 *
 * The digest's value is entirely in the click. A message whose links land on a
 * filtered queue sends the reader to whatever that filter points at today, and a
 * message whose links land on a case that has since been re-derived under
 * another id sends them nowhere — both of which turn a digest into a thing
 * people learn to ignore. So the assertions here are about the address, the
 * sentence on arrival, and the one action the case then offers.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(moduleDir, "../../app/(app)");
const AT = "2026-08-25T06:00:00.000Z";
const DATE = "2026-08-25";
const APP = "https://watch.example.com/page-watch";

/**
 * Whoever walked the case down the lifecycle below.
 *
 * The address is the case's id and nothing else, so who moved it is exactly the
 * kind of fact the link is not allowed to carry. This exists to satisfy the
 * transition guard and is never asserted on.
 */
const PERSON: Caller = { kind: "person", userId: "rae@webflow.com" };

function caseOf(overrides: Partial<IssueCase> = {}): IssueCase {
  return {
    id: "PW-2291",
    cause: "c",
    state: "new",
    title: "Unused JavaScript",
    diagnosis: "The homepage ships a bundle nothing on it uses.",
    detectedAt: AT,
    confirmedRuns: 2,
    scope: "pages",
    pageIds: ["home"],
    strategies: ["mobile"],
    impactMs: 1800,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: ["Remove it."], actionability: "direct" },
    successCriteria: "Gone.",
    checkpoints: [],
    evidence: [],
    history: [],
    ...overrides,
  };
}

const PAGES = [{ ...pendingPage("home", "Home", "https://example.com", "watching"), lastRunAt: AT }];

function digestOf(cases: IssueCase[]) {
  return buildDigest({
    site: "example.com",
    date: DATE,
    cadence: "daily",
    cases,
    pages: PAGES,
    thresholds: normalizePerformanceThresholds({}),
    appUrl: APP,
  });
}

/* ── The address is a case, not a queue ─────────────────────────────────── */

describe("the case route", () => {
  it("is the case's id under /issues, with nothing in between", () => {
    expect(existsSync(path.join(appDir, "issues", "[id]", "page.tsx"))).toBe(true);
    expect(casePath("PW-2291")).toBe("/issues/PW-2291");
  });

  it("needs no disambiguating segment, because a queue is not a segment", () => {
    /**
     * A `/case/` segment was added here and reverted. Its case was that
     * `/issues/watch` is ambiguous between a queue and a case called "watch" —
     * but a queue is a FILTER, and every filter in this app is a query
     * parameter. There is nothing for a segment to disambiguate, and a segment
     * that says only "this is a case" repeats what the id already says.
     *
     * These are the two halves of that, checked against each other rather than
     * restated: no queue is a route, and the list reads its queue from the
     * query string. The day either stops being true the ambiguity is real again
     * and this fails, which is the point — it is the mechanism, not a comment
     * asking the next editor to remember.
     */
    for (const queue of QUEUES) {
      expect(existsSync(path.join(appDir, "issues", queue)), `${queue} is a route`).toBe(false);
    }
    const list = readFileSync(path.join(appDir, "issues", "page.tsx"), "utf8");
    expect(list).toContain('searchParams.get("queue")');
  });

  it("is spelled once, so the digest and the list cannot disagree", () => {
    // The row's href and the digest's href are the same function with a base on
    // it. Two spellings would be two places for a route change to be missed.
    expect(caseHref("/page-watch", "PW-2291")).toBe("/page-watch/issues/PW-2291");
    expect(digestOf([caseOf()]).sections[0].lines[0].href).toContain(casePath("PW-2291"));
    const row = readFileSync(path.resolve(moduleDir, "../../components/issue-row.tsx"), "utf8");
    expect(row).not.toMatch(/DESTINATION_PATH\.issues\}\/\$\{/);
  });

  it("carries an id that survives the case moving through its lifecycle", () => {
    /**
     * "Every digest link opens the same case three weeks later." The address is
     * the case's id and nothing else — no queue, no state, no date — so a link
     * built on the night the case was new still resolves after it has been
     * accepted, started, fixed and brought back. This walks that whole path and
     * checks the address never moves.
     */
    const link = digestOf([caseOf()]).sections[0].lines[0].href;
    let issue = caseOf();
    issue = accept(issue, { by: PERSON, at: AT });
    issue = start(issue, { by: PERSON, at: AT });
    issue = markFixed(issue, { by: PERSON, at: AT });
    issue = recordCheckpointReading(issue, { interval: "7d", outcome: "disagreed", at: AT }).issue;
    expect(issue.state).toBe("reopened");
    expect(issue.id).toBe("PW-2291");
    expect(link).toContain(absoluteUrl(APP, casePath(issue.id)));
    // Nothing in the address describes the case's situation, which is why.
    const route = link.slice(APP.length);
    expect(route).not.toContain("queue=");
    expect(route.split("?")[0]).toBe(casePath("PW-2291"));
  });

  it("escapes an id that would otherwise change the path", () => {
    expect(casePath("PW/2291?x=1")).toBe("/issues/PW%2F2291%3Fx%3D1");
  });
});

/* ── What the URL carries, and what it does not ─────────────────────────── */

describe("the arrival parameters", () => {
  it("carry the digest and the section, and never the sentence", () => {
    const query = digestArrivalQuery(DATE, "came_back");
    expect(query).toBe(`${DIGEST_DATE_PARAM}=2026-08-25&${DIGEST_LINE_PARAM}=came_back`);
    // The prose is not in the URL. A link carrying its own text would be a copy
    // of a sentence the app can derive, and the copy would outlive the
    // derivation (rule 20).
    expect(query).not.toMatch(/came back|Unused/i);
  });

  it("round-trip for every section the digest has", () => {
    for (const kind of DIGEST_SECTIONS) {
      const params = new URLSearchParams(digestArrivalQuery(DATE, kind));
      expect(parseDigestArrival((key) => params.get(key))).toEqual({ date: DATE, kind });
    }
  });

  it("read as no arrival at all when they are absent or unrecognised", () => {
    const read = (values: Record<string, string>) => (key: string) => values[key] ?? null;
    expect(parseDigestArrival(read({}))).toBeNull();
    expect(parseDigestArrival(read({ [DIGEST_DATE_PARAM]: DATE }))).toBeNull();
    expect(parseDigestArrival(read({ [DIGEST_LINE_PARAM]: "came_back" }))).toBeNull();
    expect(parseDigestArrival(read({ [DIGEST_DATE_PARAM]: DATE, [DIGEST_LINE_PARAM]: "inbox" }))).toBeNull();
  });
});

/* ── The banner says the line, in the line's own words ──────────────────── */

describe("the context banner", () => {
  const context = {
    pageTitles: { home: "Home" },
    pagesById: Object.fromEntries(PAGES.map((page) => [page.id, page])),
    thresholds: normalizePerformanceThresholds({}),
    date: DATE,
  };

  it("repeats the line the message wrote, because both come from one writer", () => {
    const reopened = recordCheckpointReading(
      markFixed(caseOf({ state: "in_progress" }), { by: PERSON, at: AT }),
      { interval: "7d", outcome: "disagreed", at: AT },
    ).issue;
    const digest = digestOf([reopened]);
    const [line] = digest.sections[0].lines;
    // The banner calls exactly this, with the section from the URL. If the two
    // ever diverged, this is the assertion that fails.
    expect(digestLineFor("came_back", reopened, context)).toBe(line.text);
  });

  it("has no line to repeat for Held, which is a count rather than a case", () => {
    // W1's ruling, as a property: there is no per-case sentence for Held, so a
    // Held link cannot be a case link and cannot raise a banner.
    expect(digestLineFor("held", caseOf({ state: "fixed" }), context)).toBeNull();
  });

  it("does not persist across visits, because it stores nothing", () => {
    /**
     * The whole of the banner's state is the two query parameters. Dismissal
     * strips them; nothing is written down, so nothing can bring it back on a
     * later visit — and a reader opening the case from the list gets no banner
     * because the link they followed said nothing about a digest.
     */
    const banner = readFileSync(path.resolve(moduleDir, "../../components/digest-banner.tsx"), "utf8");
    for (const store of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
      expect(banner, `the banner must not remember itself in ${store}`).not.toContain(store);
    }
    const page = readFileSync(path.join(appDir, "issues", "[id]", "page.tsx"), "utf8");
    // Dismissal is a URL change, and it removes both parameters — leaving one
    // behind would make the arrival unparseable rather than absent, which is the
    // same outcome by accident instead of on purpose.
    expect(page).toContain("next.delete(DIGEST_DATE_PARAM)");
    expect(page).toContain("next.delete(DIGEST_LINE_PARAM)");
    expect(page).toContain("router.replace");
  });

  it("is rendered above the case, so dismissing it hides nothing", () => {
    const page = readFileSync(path.join(appDir, "issues", "[id]", "page.tsx"), "utf8");
    expect(page.indexOf("<DigestBanner")).toBeLessThan(page.indexOf("<CaseDetail"));
  });
});

/* ── One primary action, and it is the state's next legal move ───────────── */

describe("the primary action", () => {
  it("is a transition the registry allows a person to fire from that state", () => {
    for (const state of WORK_STATES) {
      const action = primaryActionFor(state);
      expect(action, `${state} offers a person nothing`).not.toBeNull();
      const transition = ISSUE_TRANSITIONS[action as IssueAction];
      expect(transition.from, `${action} is not legal from ${state}`).toContain(state);
      expect(transition.actor, `${action} is not a person's to fire`).toContain("person");
    }
  });

  it("never offers Resolve, which the registry says nobody presses", () => {
    for (const state of WORK_STATES) {
      expect(primaryActionFor(state)).not.toBe("resolve");
      expect(personActionsFor(state)).not.toContain("resolve");
    }
    // Derived from the actor list rather than from a list of exceptions, so a
    // future system-only transition is excluded without anyone remembering.
    expect(ISSUE_TRANSITIONS.resolve.actor).toEqual(["system"]);
  });

  it("leads with the move that advances the work where a state offers two", () => {
    /**
     * Expected values are derived from the registry rather than written down: the
     * advancing move is the one landing in a state the progression ranks, and
     * `dismissed` and `reopened` are deliberately off that ranking because they
     * are decisions. Asserting a hand-written map would assert a mirror.
     */
    const progression: IssueState[] = ["new", "todo", "in_progress", "fixed", "resolved"];
    for (const state of WORK_STATES) {
      const options = personActionsFor(state);
      const advancing = options.filter((action) => progression.includes(ISSUE_TRANSITIONS[action].to));
      const expected = advancing[0] ?? options[0];
      expect(primaryActionFor(state), `${state} leads with the wrong move`).toBe(expected);
    }
    // The two the reader meets from a digest line, spelled out for readability.
    expect(primaryActionFor("reopened")).toBe("accept");
    expect(primaryActionFor("fixed")).toBe("reopen");
  });

  it("is what the case header renders, so no header can show an illegal move", () => {
    const detail = readFileSync(path.resolve(moduleDir, "../../components/case-detail.tsx"), "utf8");
    expect(detail).toContain("primaryActionFor(issue.state)");
    expect(detail).toContain("personActionsFor(issue.state)");
    // The header no longer hard-codes the Decide pair, which was showing Accept
    // on a Fixed case — a transition the registry does not have.
    const parts = readFileSync(path.resolve(moduleDir, "../../components/case-detail-parts.tsx"), "utf8");
    expect(parts).not.toContain("onAccept");
    expect(parts).not.toContain("ISSUE_ACTION_LABEL.dismiss");
  });
});
