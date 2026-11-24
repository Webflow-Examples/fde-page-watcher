import { describe, expect, it } from "vitest";
import { STALE_AFTER_DAYS, caseStaleness, daysSince, lastCheckedAtFor } from "../case-recency";
import { issueCasesFrom } from "../issue-cases";
import type { Rec, ScoreByCategory, WatchPage } from "../types";

/**
 * When a case was last checked.
 *
 * The three decisions worth pinning: a case with no run is not "rechecked", the
 * seven-day boundary is strict, and a case spanning pages with different runs
 * reports the newest one.
 */

const ZERO: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };
const REFERENCE = "2026-08-24T06:00:00.000Z";

function makePage(overrides: Partial<WatchPage> = {}): WatchPage {
  return {
    id: "home",
    title: "Home",
    url: "example.com",
    flag: "watching",
    status: "stable",
    current: { mobile: ZERO, desktop: ZERO },
    history: [],
    markers: [],
    agent: [],
    ...overrides,
  };
}

function makeRec(overrides: Partial<Rec> = {}): Rec {
  return {
    key: "home:unused-javascript",
    pageId: "home",
    pageTitle: "Home",
    url: "example.com",
    id: "unused-javascript",
    source: "lighthouse",
    title: "Reduce unused JavaScript",
    category: "Performance",
    savings: "1.8 s",
    estTime: "2 days",
    status: "inbox",
    taskStatus: "todo",
    added: "2026-08-02",
    doneDate: null,
    ...overrides,
  };
}

describe("when a case was last checked", () => {
  it("says nothing when no page the case covers has run", () => {
    expect(lastCheckedAtFor(["home"], [makePage({ lastRunAt: undefined })])).toBeUndefined();
    expect(lastCheckedAtFor(["missing"], [makePage()])).toBeUndefined();
    expect(caseStaleness(undefined, REFERENCE)).toEqual({ stale: false });
    // And the case carries no date rather than a fabricated one.
    const [issue] = issueCasesFrom({ pages: [makePage()], recs: [makeRec()] });
    expect(issue.lastCheckedAt).toBeUndefined();
    expect(caseStaleness(issue.lastCheckedAt, REFERENCE).stale).toBe(false);
  });

  it("takes the latest run among the pages a case covers", () => {
    const pages = [
      makePage({ id: "home", lastRunAt: "2026-07-20T06:00:00.000Z" }),
      makePage({ id: "pricing", lastRunAt: "2026-08-24T05:00:00.000Z" }),
    ];
    const [issue] = issueCasesFrom({
      pages,
      recs: [
        makeRec({ key: "home:unused-javascript", pageId: "home" }),
        makeRec({ key: "pricing:unused-javascript", pageId: "pricing", pageTitle: "Pricing" }),
      ],
    });
    expect(issue.pageIds).toEqual(["home", "pricing"]);
    expect(issue.lastCheckedAt).toBe("2026-08-24T05:00:00.000Z");
  });

  it("marks stale only when the latest run is older than seven days", () => {
    const sevenDays = new Date(Date.parse(REFERENCE) - STALE_AFTER_DAYS * 86_400_000).toISOString();
    const justOver = new Date(Date.parse(REFERENCE) - (STALE_AFTER_DAYS * 86_400_000 + 1)).toISOString();
    expect(daysSince(sevenDays, REFERENCE)).toBe(7);
    expect(caseStaleness(sevenDays, REFERENCE)).toEqual({ daysSince: 7, stale: false });
    expect(caseStaleness(justOver, REFERENCE).stale).toBe(true);
    // A run after the reference (the reference is the newest run, but a page
    // can carry a later stamp in stored data) is never stale.
    expect(caseStaleness("2026-09-01T00:00:00.000Z", REFERENCE).stale).toBe(false);
  });

  it("is a pure reading: the same two dates give the same answer in any order", () => {
    const old = "2026-08-01T06:00:00.000Z";
    expect(daysSince(old, REFERENCE)).toBe(23);
    expect(daysSince(REFERENCE, old)).toBe(-23);
    expect(caseStaleness("not a date", REFERENCE)).toEqual({ stale: false });
  });

  it("counts the runs a repeated Lighthouse sample saw, and none for a record that has no count", () => {
    const [sampled] = issueCasesFrom({ pages: [makePage()], recs: [makeRec({ observedRuns: 4 })] });
    expect(sampled.confirmedRuns).toBe(4);
    const [crux] = issueCasesFrom({
      pages: [makePage()],
      recs: [makeRec({ id: "crux-field-only-inp", source: "crux-field-only", savings: "Field signal" })],
    });
    expect(crux.confirmedRuns).toBe(0);
  });
});
