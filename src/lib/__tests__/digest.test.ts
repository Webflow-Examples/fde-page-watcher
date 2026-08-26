import { describe, expect, it } from "vitest";
import {
  DIGEST_SECTIONS,
  buildDigest,
  daysSinceAnswered,
  digestSectionOf,
  digestSiteOf,
  type Digest,
  type DigestInput,
  type DigestSectionKind,
} from "../digest";
import { DIGEST_NOTHING, DIGEST_SECTION_HEADING, digestOpenSince } from "../digest-copy";
import { digestLinks, renderDigestMessage } from "../digest-email";
import { DIGEST_CADENCE_LABEL } from "../digestCadence";
import { formatImpact } from "../impact-format";
import { markFixed, scheduleCheckpoints, type IssueCase } from "../issue-case";
import type { Caller } from "../caller";
import { recordCheckpointReading } from "../checkpoint-evaluation";
import { normalizePerformanceThresholds } from "../performanceThresholds";
import { casePath } from "../paths";
import { DESTINATION_PATH } from "../vocabulary";
import type { WatchPage } from "../types";
import { pendingPage } from "../mutations";

/**
 * The digest: what one message says, and what it is not allowed to say.
 *
 * The locked lines are asserted verbatim, because they are the decision. Around
 * them sit assertions about properties of the whole message, because the
 * failures the digest is designed against are all properties: a subject that
 * contradicts the body, a heading with nothing under it, a line the reader
 * cannot act on, a number no run produced. Checking each sentence in isolation
 * would catch none of those.
 */

const AT = "2026-08-25T06:00:00.000Z";
const DATE = "2026-08-25";
const APP = "https://watch.example.com/page-watch";
const SCHEDULE = { localTime: "00:00", timeZone: "America/Chicago", overridden: true };

function caseOf(overrides: Partial<IssueCase> = {}): IssueCase {
  return {
    id: "PW-1",
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

/**
 * Whoever marked the fix. The digest never renders them — it is about cases, not
 * about who moved them — so this exists only to satisfy the transition guard.
 */
const PERSON: Caller = { kind: "person", userId: "rae@webflow.com" };

/** A case the system brought back, produced by the evaluator rather than posed. */
function cameBackCase(overrides: Partial<IssueCase> = {}): IssueCase {
  const fixed = markFixed(caseOf({ state: "in_progress", ...overrides }), { by: PERSON, at: AT });
  return recordCheckpointReading(fixed, { interval: "7d", outcome: "disagreed", at: AT }).issue;
}

/** A fixed case still waiting: three checkpoints scheduled, nothing read. */
function heldCase(overrides: Partial<IssueCase> = {}): IssueCase {
  return markFixed(caseOf({ state: "in_progress", ...overrides }), { by: PERSON, at: AT });
}

/** A fixed case whose three checks all failed to read — evaluation rule 4. */
function unreadableCase(overrides: Partial<IssueCase> = {}): IssueCase {
  return caseOf({
    state: "fixed",
    checkpoints: scheduleCheckpoints(AT).map((checkpoint) => ({
      ...checkpoint,
      attempts: 2,
      result: "unavailable" as const,
    })),
    history: [{ at: AT, from: "in_progress", to: "fixed", by: PERSON }],
    ...overrides,
  });
}

function pageOf(id: string, title: string, url: string, overrides: Partial<WatchPage> = {}): WatchPage {
  return {
    ...pendingPage(id, title, url, "watching"),
    // Noon UTC so the calendar day is the same either side of the date line.
    lastRunAt: "2026-07-26T12:00:00.000Z",
    ...overrides,
  };
}

function digestOf(overrides: Partial<DigestInput> = {}): Digest {
  return buildDigest({
    site: "example.com",
    date: DATE,
    cadence: "daily",
    cases: [],
    pages: [pageOf("home", "Home", "https://www.example.com")],
    thresholds: normalizePerformanceThresholds({}),
    schedule: SCHEDULE,
    appUrl: APP,
    locale: "en-GB",
    ...overrides,
  });
}

const kindsOf = (digest: Digest): DigestSectionKind[] => digest.sections.map((section) => section.kind);
const linesIn = (digest: Digest, kind: DigestSectionKind) =>
  digest.sections.find((section) => section.kind === kind)?.lines ?? [];

/* ── The locked copy, verbatim ──────────────────────────────────────────── */

describe("the locked lines", () => {
  it("says the subject exactly, in both of its forms", () => {
    expect(digestOf().subject).toBe("example.com · nothing needs you");
    expect(digestOf({ cases: [cameBackCase(), cameBackCase({ id: "PW-2" })] }).subject)
      .toBe("example.com · 2 fixes came back");
    // Singular reads as a sentence rather than as a template.
    expect(digestOf({ cases: [cameBackCase()] }).subject).toBe("example.com · 1 fix came back");
  });

  it("names the four sections exactly", () => {
    expect(DIGEST_SECTION_HEADING).toEqual({
      came_back: "Came back",
      to_decide: "To decide",
      held: "Held",
      could_not_measure: "Could not measure",
    });
  });

  it("says the Came back line exactly", () => {
    const digest = digestOf({
      cases: [cameBackCase()],
      thresholds: normalizePerformanceThresholds({ minimumSavingsMs: 500 }),
    });
    expect(linesIn(digest, "came_back")[0].text).toBe(
      "The Unused JavaScript on Home is back. The 7-day check still measured 1.8 s, above the 500 ms you set.",
    );
  });

  it("says the To decide line exactly", () => {
    expect(linesIn(digestOf({ cases: [caseOf()] }), "to_decide")[0].text).toBe(
      `The homepage ships a bundle nothing on it uses. Open since ${digestOpenSince(AT, "en-GB")}.`,
    );
  });

  it("says the Held line exactly", () => {
    const digest = digestOf({ cases: [heldCase({ id: "A" }), heldCase({ id: "B" }), heldCase({ id: "C" })] });
    expect(linesIn(digest, "held")[0].text).toBe("3 fixes held.");
    expect(linesIn(digestOf({ cases: [heldCase()] }), "held")[0].text).toBe("1 fix held.");
  });

  it("says the Could not measure line exactly", () => {
    expect(linesIn(digestOf({ cases: [unreadableCase()] }), "could_not_measure")[0].text).toBe(
      "Home has not answered for 30 days, so one fix cannot be checked.",
    );
  });

  it("says the footer exactly", () => {
    const digest = digestOf({
      pages: [
        pageOf("home", "Home", "https://www.example.com"),
        pageOf("pricing", "Pricing", "https://www.example.com/pricing"),
      ],
    });
    expect(digest.footer.text).toBe(
      "2 pages measured at 00:00 America/Chicago. Daily digest for example.com — change how often.",
    );
    // The cadence word is the registry of cadences', not a second spelling.
    expect(digest.footer.text).toContain(DIGEST_CADENCE_LABEL.daily);
  });
});

/* ── One message per run, quiet ones included ───────────────────────────── */

describe("a run that found nothing", () => {
  it("still produces a message, and its subject answers the day on its own", () => {
    const quiet = digestOf();
    expect(quiet.subject).toBe(`example.com · ${DIGEST_NOTHING}`);
    // Nothing to report is not the same as nothing to send. The message exists,
    // which is what makes an absent one mean an absent run.
    expect(quiet.sections).toEqual([]);
    const message = renderDigestMessage(quiet);
    expect(message.text).toContain(DIGEST_NOTHING);
    // And the footer is still there, saying how often to expect the next one.
    expect(message.text).toContain(quiet.footer.text);
  });

  it("states the cadence on every message, so silence is readable", () => {
    for (const digest of [digestOf(), digestOf({ cases: [cameBackCase()] })]) {
      expect(digest.footer.text).toContain("Daily digest");
      expect(digest.footer.href).toBe(`${APP}${DESTINATION_PATH.settings}`);
    }
  });
});

/* ── Four sections, fixed order, never empty ────────────────────────────── */

describe("the sections", () => {
  it("appear in one order regardless of what the run found", () => {
    const digest = digestOf({
      // Deliberately handed over in the reverse of the rendered order.
      cases: [unreadableCase({ id: "PW-4" }), heldCase({ id: "PW-3" }), caseOf({ id: "PW-2" }), cameBackCase()],
    });
    expect(kindsOf(digest)).toEqual([...DIGEST_SECTIONS]);
  });

  it("are omitted when empty rather than rendered empty", () => {
    const digest = digestOf({ cases: [heldCase()] });
    expect(kindsOf(digest)).toEqual(["held"]);
    const text = renderDigestMessage(digest).text;
    // An empty section's heading must not appear at all: a heading with nothing
    // under it reads as a measurement that found nothing (rule 18).
    for (const kind of DIGEST_SECTIONS) {
      if (kind === "held") continue;
      expect(text).not.toContain(DIGEST_SECTION_HEADING[kind]);
    }
  });

  it("puts every case in at most one of them", () => {
    /**
     * A case in two sections would be counted twice by the subject, and a Held
     * count that included the fixes with no reading would be reassurance built
     * from the cases with no evidence at all.
     */
    const digest = digestOf({
      cases: [cameBackCase(), caseOf({ id: "PW-2" }), heldCase({ id: "PW-3" }), unreadableCase({ id: "PW-4" })],
    });
    const placed = digest.sections.flatMap((section) =>
      section.lines.flatMap((line) => (line.caseId ? [line.caseId] : [])),
    );
    expect(new Set(placed).size).toBe(placed.length);
    expect(digestSectionOf(unreadableCase())).toBe("could_not_measure");
    expect(digestSectionOf(heldCase())).toBe("held");
    expect(linesIn(digest, "held")[0].text).toBe("1 fix held.");
  });

  it("reports nothing about a case with nothing outstanding", () => {
    for (const state of ["resolved", "dismissed"] as const) {
      expect(digestSectionOf(caseOf({ state }))).toBeNull();
      expect(digestOf({ cases: [caseOf({ state })] }).sections).toEqual([]);
    }
  });

  it("separates a fix that came back from a case somebody reopened by hand", () => {
    // Only a checkpoint disagreement is "came back". A person changing their
    // mind lands in Decide too, and it is not news about a fix.
    expect(digestSectionOf(cameBackCase())).toBe("came_back");
    expect(digestSectionOf(caseOf({ state: "reopened" }))).toBe("to_decide");
    expect(digestOf({ cases: [caseOf({ state: "reopened" })] }).subject).toContain(DIGEST_NOTHING);
  });
});

/* ── Rule 18 — withhold the claim, do not fail and do not invent ────────── */

describe("a reading nobody took", () => {
  it("withholds the threshold claim and still reports that the fix came back", () => {
    /**
     * The half of rule 18 that matters most here. "still measured Not measured,
     * above the 500 ms you set" is a conclusion resting on a reading nobody
     * took; the honest response is to say less, not to fail. The news survives.
     */
    const digest = digestOf({
      cases: [cameBackCase({ impactMs: 0 })],
      thresholds: normalizePerformanceThresholds({ minimumSavingsMs: 500 }),
    });
    const [line] = linesIn(digest, "came_back");
    expect(line.text).toBe("The Unused JavaScript on Home is back.");
    expect(line.text).not.toContain(formatImpact(0).text);
    expect(line.text).not.toContain("you set");
    // Withholding the good news must not swallow the bad: the subject still
    // carries the verdict, and the line is still a link to the case.
    expect(digest.subject).toBe("example.com · 1 fix came back");
    expect(line.caseId).toBe("PW-1");
  });

  it("withholds it again when there is no limit the reader set", () => {
    // At 0 the gate is off, so there is nothing to attribute to anyone.
    const digest = digestOf({ cases: [cameBackCase()] });
    expect(linesIn(digest, "came_back")[0].text).toBe("The Unused JavaScript on Home is back.");
  });

  it("withholds the age of a case whose detection date will not parse", () => {
    const digest = digestOf({ cases: [caseOf({ detectedAt: "not a date" })] });
    expect(linesIn(digest, "to_decide")[0].text).toBe("The homepage ships a bundle nothing on it uses.");
    expect(digestOpenSince("not a date")).toBeNull();
  });

  it("never throws on an absent reading, whatever is missing", () => {
    // An absent value is not a malformed shape. A digest that crashed rather
    // than omitting a clause would trade a false claim for no message at all,
    // which is the one outcome the design is arranged against.
    expect(() => digestOf({
      cases: [
        cameBackCase({ impactMs: 0 }),
        caseOf({ id: "PW-2", detectedAt: "", impactMs: 0, diagnosis: "", pageIds: [] }),
        unreadableCase({ id: "PW-3", pageIds: ["gone"] }),
      ],
      pages: [pageOf("home", "Home", "https://example.com", { lastRunAt: undefined, history: [] })],
    })).not.toThrow();
  });

  it("does not write about what the reader asked not to hear, but keeps the unmeasured", () => {
    const small = digestOf({
      cases: [caseOf({ impactMs: 120 })],
      thresholds: normalizePerformanceThresholds({ minimumSavingsMs: 500 }),
    });
    expect(small.sections).toEqual([]);
    // An unmeasured case is not a small one, so the gate does not catch it.
    const unmeasured = digestOf({
      cases: [caseOf({ impactMs: 0 })],
      thresholds: normalizePerformanceThresholds({ minimumSavingsMs: 500 }),
    });
    expect(kindsOf(unmeasured)).toEqual(["to_decide"]);
  });

  it("counts only the pages a run actually measured", () => {
    const digest = digestOf({
      pages: [
        pageOf("home", "Home", "https://www.example.com"),
        pageOf("pricing", "Pricing", "https://www.example.com/pricing", { runState: "failed" }),
      ],
    });
    // A page whose run failed produced no measurement, so the footer does not
    // count it. "1 page measured" and "2 pages measured" are different nights.
    expect(digest.footer.text).toContain("1 page measured");
  });
});

/* ── Every line is a sentence with a link ───────────────────────────────── */

describe("every line", () => {
  const digest = digestOf({
    cases: [cameBackCase(), caseOf({ id: "PW-2" }), heldCase({ id: "PW-3" }), unreadableCase({ id: "PW-4" })],
    thresholds: normalizePerformanceThresholds({ minimumSavingsMs: 500 }),
  });
  const lines = digest.sections.flatMap((section) => section.lines);

  it("is a sentence and carries somewhere to go", () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.text.trim()).toBe(line.text);
      expect(line.text, `not a sentence: ${line.text}`).toMatch(/[.]$/);
      expect(line.href).toBeTruthy();
    }
  });

  it("resolves to the case when it is about a case, and never to a queue", () => {
    for (const line of lines) {
      if (!line.caseId) continue;
      expect(line.href).toContain(casePath(line.caseId));
      // A filtered queue URL is the thing a case line must never be.
      expect(line.href).not.toContain("queue=");
    }
  });

  it("leaves the case only for the Held count, which is not about one", () => {
    const strays = lines.filter((line) => !line.caseId);
    expect(strays).toHaveLength(1);
    expect(strays[0].text).toBe("1 fix held.");
    expect(strays[0].href).toContain("queue=watch");
  });
});

/* ── No composite scores, no invented totals ────────────────────────────── */

describe("the whole message", () => {
  it("carries no composite score and adds nothing together", () => {
    const digest = digestOf({
      cases: [
        cameBackCase({ id: "PW-1", impactMs: 1800 }),
        cameBackCase({ id: "PW-2", impactMs: 900, pageIds: ["pricing"] }),
      ],
      pages: [
        pageOf("home", "Home", "https://www.example.com"),
        pageOf("pricing", "Pricing", "https://www.example.com/pricing"),
      ],
      thresholds: normalizePerformanceThresholds({ minimumSavingsMs: 500 }),
    });
    const message = renderDigestMessage(digest);
    for (const body of [message.subject, message.text, message.html]) {
      expect(body).not.toMatch(/\/\s?100\b/);
      expect(body.toLowerCase()).not.toContain("score");
      expect(body.toLowerCase()).not.toContain("overall");
    }
    // 1800 and 900 never become 2700 (rule 19). Each line carries its own
    // reading, and there is no figure standing for the pair.
    expect(message.text).not.toContain("2.7 s");
    expect(message.text).toContain("1.8 s");
    expect(message.text).toContain("900 ms");
  });

  it("writes every figure through impact-format rather than its own arithmetic", () => {
    const digest = digestOf({
      cases: [cameBackCase({ impactMs: 12_400 })],
      thresholds: normalizePerformanceThresholds({ minimumSavingsMs: 250 }),
    });
    expect(linesIn(digest, "came_back")[0].text).toContain(formatImpact(12_400).text);
    expect(linesIn(digest, "came_back")[0].text).toContain(formatImpact(250).text);
  });

  it("escapes what it renders as HTML", () => {
    const digest = digestOf({ cases: [caseOf({ diagnosis: "A <script> tag & a \"quote\"." })] });
    const { html } = renderDigestMessage(digest);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("names no colour, so a dark mail client is not given pale text", () => {
    const digest = digestOf({ cases: [caseOf()] });
    expect(renderDigestMessage(digest).html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|color:/);
  });
});

/* ── Every link is a live destination ───────────────────────────────────── */

describe("the links", () => {
  it("all resolve under one of the registry's four destinations", () => {
    /**
     * The retired destinations are the ones a template written a year ago would
     * still point at. This does not enumerate them: it asserts that every
     * address the message carries is under a path the registry currently names,
     * so a destination that stops existing takes its links with it.
     */
    const digest = digestOf({
      cases: [cameBackCase(), caseOf({ id: "PW-2" }), heldCase({ id: "PW-3" }), unreadableCase({ id: "PW-4" })],
    });
    const live = Object.values(DESTINATION_PATH);
    for (const href of digestLinks(digest)) {
      expect(href.startsWith(APP), `${href} is not on the app`).toBe(true);
      const route = href.slice(APP.length);
      expect(
        live.some((to) => route === to || /^[/?#]/.test(route.slice(to.length)) && route.startsWith(to)),
        `${route} is not under a live destination`,
      ).toBe(true);
    }
  });

  it("is absolute, so it works from a mail client", () => {
    for (const href of digestLinks(digestOf({ cases: [caseOf()] }))) {
      expect(href).toMatch(/^https:\/\//);
    }
  });

  it("is visibly broken rather than quietly wrong when the app has no public URL", () => {
    // A root-relative link in an email resolves against nothing useful. That is
    // the point: a deployment that has not been told its own address should send
    // a link that obviously fails, not one that silently resolves elsewhere.
    for (const href of digestLinks(digestOf({ cases: [caseOf()], appUrl: "" }))) {
      expect(href.startsWith("/")).toBe(true);
    }
  });
});

/* ── Counting days, and naming the site ─────────────────────────────────── */

describe("how long a page has been silent", () => {
  it("counts whole days from the cohort's own day, not the wall clock", () => {
    const page = pageOf("home", "Home", "https://example.com");
    expect(daysSinceAnswered(page, "2026-08-25")).toBe(30);
    expect(daysSinceAnswered(page, "2026-07-26")).toBe(0);
  });

  it("is null for a page that has never answered, rather than a very large number", () => {
    const never = pageOf("home", "Home", "https://example.com", { lastRunAt: undefined, history: [] });
    expect(daysSinceAnswered(never, "2026-08-25")).toBeNull();
  });
});

describe("the site", () => {
  it("is the host of the watched pages, without the www nobody says", () => {
    expect(digestSiteOf({ pages: [pageOf("home", "Home", "https://www.example.com/pricing")] }))
      .toBe("example.com");
  });

  it("prefers a page the project is actually watching", () => {
    const paused = pageOf("old", "Retired", "https://old.example.net", { flag: "paused" });
    expect(digestSiteOf({ pages: [paused, pageOf("home", "Home", "https://example.com")] }))
      .toBe("example.com");
  });

  it("uses a URL it cannot parse as it stands rather than inventing a name", () => {
    expect(digestSiteOf({ pages: [pageOf("home", "Home", "not a url")] })).toBe("not a url");
  });
});
