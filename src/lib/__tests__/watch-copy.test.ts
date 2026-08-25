import { describe, expect, it } from "vitest";
import {
  HISTORY_RESOLVED,
  WATCH_EMPTY,
  WATCH_MARK_PILL_NONE,
  WATCH_NO_READING,
  ariaCheckpoint,
  daysUntil,
  formatDate,
  historyReopened,
  historyUnavailable,
  watchIntro,
  watchMarkPill,
  watchRowFixed,
  watchRowFixedUnavailable,
  watchTrackAgreed,
  watchTrackDue,
  watchTrackProgress,
  watchTrackSegment,
} from "../watch-copy";

/**
 * Watch's copy, and the arithmetic behind the countdown.
 *
 * The strings are locked, so they are asserted verbatim: this is the test that
 * fails when someone paraphrases "Nothing is waiting on evidence." into
 * "No items found". The dates get more attention than the words, because the
 * countdown on the row and the due date in the drawer are two renderings of one
 * instant and a reader who sees them disagree has no way to tell which lied.
 */

/** Local-time construction throughout, so the run's own zone cannot skew it. */
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

describe("the countdown pill", () => {
  it("counts whole days ahead", () => {
    expect(watchMarkPill(localNoon(2026, 9, 1).toISOString(), localNoon(2026, 8, 11))).toBe("in 21 days");
  });

  it("says today on the day it is due", () => {
    expect(watchMarkPill(localNoon(2026, 8, 11).toISOString(), localNoon(2026, 8, 11))).toBe("today");
  });

  it("says today rather than a negative count once it is overdue", () => {
    // A check that is late is not "in −2 days". It is still what the row is
    // waiting for.
    expect(watchMarkPill(localNoon(2026, 8, 9).toISOString(), localNoon(2026, 8, 11))).toBe("today");
  });

  it("uses the singular at one day", () => {
    expect(watchMarkPill(localNoon(2026, 8, 12).toISOString(), localNoon(2026, 8, 11))).toBe("in 1 day");
  });

  it("says none left when there is no date to count to", () => {
    expect(watchMarkPill(undefined, localNoon(2026, 8, 11))).toBe(WATCH_MARK_PILL_NONE);
    expect(WATCH_MARK_PILL_NONE).toBe("none left");
  });
});

describe("the countdown and the drawer's date", () => {
  /**
   * They are the same instant rendered twice, so they have to move together.
   * The count is in local calendar days and the date is the local calendar day,
   * which is what makes that true rather than nearly true.
   */
  const due = localNoon(2026, 8, 20);

  it("changes only when the local calendar day changes", () => {
    const lateEvening = new Date(2026, 7, 11, 23, 59, 0);
    const justAfterMidnight = new Date(2026, 7, 12, 0, 1, 0);
    const sameDayMorning = new Date(2026, 7, 11, 6, 0, 0);

    // Two instants two minutes apart, either side of midnight: one day apart.
    expect(daysUntil(due.toISOString(), lateEvening)).toBe(9);
    expect(daysUntil(due.toISOString(), justAfterMidnight)).toBe(8);
    // Seventeen hours apart inside one day: no change at all.
    expect(daysUntil(due.toISOString(), sameDayMorning)).toBe(9);
  });

  it("agrees with the date the drawer prints", () => {
    // When the pill says "in 1 day", the drawer's due date is tomorrow's date.
    const dayBefore = new Date(2026, 7, 19, 8, 0, 0);
    expect(watchMarkPill(due.toISOString(), dayBefore)).toBe("in 1 day");
    expect(watchTrackDue(due.toISOString())).toBe(`due ${formatDate(due.toISOString())}`);
    // And on the day itself, both say the same day.
    const onTheDay = new Date(2026, 7, 20, 8, 0, 0);
    expect(watchMarkPill(due.toISOString(), onTheDay)).toBe("today");
    expect(formatDate(due.toISOString())).toBe(due.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }));
  });

  it("does not drift when the instant is stored in another zone's notation", () => {
    // The same moment, written three ways. A count derived from the calendar
    // day cannot care which notation it arrived in.
    const moment = Date.UTC(2026, 7, 20, 18, 30);
    const asZ = new Date(moment).toISOString();
    const asOffset = new Date(moment).toISOString().replace("Z", "+00:00");
    const now = new Date(2026, 7, 18, 9, 0, 0);
    expect(daysUntil(asOffset, now)).toBe(daysUntil(asZ, now));
  });

  it("says so when there is no date rather than inventing one", () => {
    // Rule 18: an absent value says it is absent.
    expect(formatDate(undefined)).toBe("date unknown");
    expect(formatDate("not a date")).toBe("date unknown");
    expect(daysUntil(undefined, new Date())).toBeNull();
  });
});

describe("Day n of 30", () => {
  const fixed = localNoon(2026, 8, 1).toISOString();

  it("counts from the fix", () => {
    expect(watchTrackProgress(fixed, localNoon(2026, 8, 8), 30)).toBe("Day 7 of 30");
  });

  it("starts at nought on the day of the fix", () => {
    expect(watchTrackProgress(fixed, localNoon(2026, 8, 1), 30)).toBe("Day 0 of 30");
  });

  it("never runs past the span it is out of", () => {
    // A case still in Watch on day 44 is a case whose 30-day reading has not
    // landed. "Day 44 of 30" reads as a bug in the counter.
    expect(watchTrackProgress(fixed, localNoon(2026, 9, 14), 30)).toBe("Day 30 of 30");
  });
});

describe("the locked strings", () => {
  it("says the row's fixed line exactly", () => {
    const date = localNoon(2026, 8, 1).toISOString();
    expect(watchRowFixed(date)).toBe(`Fixed ${formatDate(date)}`);
    expect(watchRowFixedUnavailable(date, "7d")).toBe(
      `Fixed ${formatDate(date)} · the 7-day check could not be taken`,
    );
  });

  it("says the track's lines exactly", () => {
    const date = localNoon(2026, 8, 3).toISOString();
    expect(watchTrackSegment("2d")).toBe("2 days");
    expect(watchTrackSegment("30d")).toBe("30 days");
    expect(watchTrackAgreed(date)).toBe(`agreed ${formatDate(date)}`);
  });

  it("says the queue's lines exactly", () => {
    expect(watchIntro(4)).toBe(
      "4 fixes are waiting on evidence. Nothing here needs you — a check that disagrees moves the case to Decide on its own.",
    );
    expect(watchIntro(1)).toBe(
      "1 fix is waiting on evidence. Nothing here needs you — a check that disagrees moves the case to Decide on its own.",
    );
    expect(WATCH_EMPTY).toBe("Nothing is waiting on evidence.");
    expect(WATCH_NO_READING).toBe(
      "No check could be taken. The fix shipped 30 days ago and this page has not answered since.",
    );
  });

  it("says the history lines in the reader's words, not the system's", () => {
    // Registry rule 16. "auto_resolved" must appear nowhere a reader can see.
    expect(HISTORY_RESOLVED).toBe("Resolved — the 30-day check agreed.");
    expect(historyReopened("7d")).toBe("Reopened — the 7-day check still found the problem.");
    expect(historyUnavailable("2d")).toBe("2-day check unavailable — the page did not answer.");
    for (const line of [HISTORY_RESOLVED, historyReopened("2d"), historyUnavailable("30d")]) {
      expect(line).not.toMatch(/auto_|_resolved|passed|failed/i);
    }
  });

  // The three digest lines moved to `digest-copy.ts` in S7, which locked their
  // wording as digest copy — two of them now carry readings and limits this
  // module knows nothing about. `digest.test.ts` asserts them verbatim.

  it("names the check, the outcome and the date for a screen reader", () => {
    const date = localNoon(2026, 8, 3).toISOString();
    expect(ariaCheckpoint("2d", "agreed", date)).toBe(`2-day check: Agreed, ${formatDate(date)}`);
    expect(ariaCheckpoint("30d", "unavailable", date)).toBe(
      `30-day check: Unavailable, ${formatDate(date)}`,
    );
  });

  it("never uses a word the registry banned for a checkpoint", () => {
    // passed/failed belong to agent_result, on a check.
    const strings = [
      HISTORY_RESOLVED,
      historyReopened("2d"),
      historyUnavailable("2d"),
      WATCH_EMPTY,
      WATCH_NO_READING,
      watchIntro(2),
      ariaCheckpoint("7d", "disagreed", undefined),
    ];
    for (const line of strings) {
      expect(line).not.toMatch(/\b(passed|failed|pass|fail|verified|pending|retest)\b/i);
    }
  });
});
