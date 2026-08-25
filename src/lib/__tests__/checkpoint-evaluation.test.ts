import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  byNextDue,
  nextScheduled,
  noReadingTaken,
  readings,
  recordCheckpointReading,
} from "../checkpoint-evaluation";
import {
  IssueCaseError,
  isTransition,
  markFixed,
  queueOf,
  scheduleCheckpoints,
  type IssueCase,
} from "../issue-case";
import { CHECKPOINT_EVALUATION } from "../vocabulary";

/**
 * The evaluator, checked against the registry's five rules rather than against
 * its own implementation.
 *
 * Registry rule 21: a test asserts the decision, not the code. So the cases
 * below are the ones `concepts.checkpoint.evaluation` describes — a
 * disagreement reopening at once, one retry and no more, thirty days of
 * agreement resolving, three failures to read resolving nothing — and not a
 * walk through the branches in source order.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(moduleDir, "../../../vocabulary.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

const FIXED_AT = "2026-08-01T00:00:00.000Z";
const DAY = 86_400_000;
const after = (days: number) => new Date(Date.parse(FIXED_AT) + days * DAY).toISOString();

/** A case that has just been marked fixed, so it carries a real schedule. */
function fixedCase(overrides: Partial<IssueCase> = {}): IssueCase {
  const base: IssueCase = {
    id: "PW-1",
    cause: "p1:unused-javascript",
    state: "in_progress",
    title: "Unused JavaScript",
    diagnosis: "The homepage ships a bundle nothing on it uses.",
    detectedAt: FIXED_AT,
    confirmedRuns: 2,
    scope: "page",
    pageIds: ["p1"],
    strategies: ["mobile"],
    impactMs: 1800,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: ["Remove the unused bundle."], actionability: "direct" },
    successCriteria: "The bundle is gone from the homepage.",
    checkpoints: [],
    evidence: [],
    history: [],
  };
  return { ...markFixed(base, { actor: "person", at: FIXED_AT }), ...overrides };
}

/* ── Rule 1 — a disagreement reopens at once ────────────────────────────── */

describe("a checkpoint that disagrees", () => {
  it("reopens the case and lands it in Decide", () => {
    const { issue, effect } = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "disagreed",
      at: after(2),
    });
    expect(effect).toBe("reopened");
    expect(issue.state).toBe("reopened");
    expect(queueOf(issue.state)).toBe("decide");
  });

  it("cancels the checkpoints that had not been read", () => {
    // Rule 1: the remaining checkpoints are cancelled, and the next mark_fixed
    // schedules a fresh set of three. A cancelled checkpoint never produced a
    // reading, so it does not survive as one.
    const { issue } = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "disagreed",
      at: after(2),
    });
    expect(issue.checkpoints.map((item) => item.interval)).toEqual(["2d"]);
    expect(issue.checkpoints[0].result).toBe("disagreed");
  });

  it("does not wait out the checkpoints that were left", () => {
    // The 7 and 30-day readings would have arrived weeks later. Nothing about
    // the case should still be pending on them.
    const { issue } = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "disagreed",
      at: after(2),
    });
    expect(nextScheduled(issue)).toBeNull();
  });

  it("writes the history line in the words the reader sees", () => {
    // Registry rule 16 — never an internal verb.
    const { issue } = recordCheckpointReading(fixedCase(), {
      interval: "7d",
      outcome: "disagreed",
      at: after(7),
    });
    expect(issue.history.at(-1)).toMatchObject({
      to: "reopened",
      actor: "system",
      reason: "Reopened — the 7-day check still found the problem.",
    });
  });

  it("narrows the case to the pages that came back", () => {
    const wide = fixedCase({ pageIds: ["p1", "p2"], scope: "pages" });
    const { issue } = recordCheckpointReading(wide, {
      interval: "7d",
      outcome: "disagreed",
      at: after(7),
      pageIds: ["p2"],
    });
    expect(issue.pageIds).toEqual(["p2"]);
  });
});

/* ── Rule 2 — unavailable retries once, then records ────────────────────── */

describe("a reading that could not be taken", () => {
  it("retries once at +24h instead of recording anything", () => {
    const { issue, effect } = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "unavailable",
      at: after(2),
    });
    expect(effect).toBe("retry_scheduled");
    const retried = issue.checkpoints.find((item) => item.interval === "2d");
    expect(retried?.due).toBe(after(3));
    // Nothing is recorded yet: the retry has not happened.
    expect(retried?.result).toBe("scheduled");
    expect(readings(issue)).toEqual([]);
  });

  it("records Unavailable when the retry fails too, and carries on", () => {
    const first = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "unavailable",
      at: after(2),
    });
    const { issue, effect } = recordCheckpointReading(first.issue, {
      interval: "2d",
      outcome: "unavailable",
      at: after(3),
    });
    expect(effect).toBe("recorded");
    expect(issue.checkpoints.find((item) => item.interval === "2d")?.result).toBe("unavailable");
    // Carried on: the case has not moved and the next check is still coming.
    expect(issue.state).toBe("fixed");
    expect(nextScheduled(issue)?.interval).toBe("7d");
  });

  it("retries only once", () => {
    let issue = fixedCase();
    for (const at of [after(2), after(3), after(4)]) {
      issue = recordCheckpointReading(issue, { interval: "2d", outcome: "unavailable", at }).issue;
    }
    expect(issue.checkpoints.find((item) => item.interval === "2d")?.result).toBe("unavailable");
  });

  it("is never counted against the fix", () => {
    // Rule 3: unavailable readings are skipped, not counted against. A case
    // that could not be read at 2 days and agreed at 7 and 30 still resolves.
    let issue = fixedCase();
    issue = recordCheckpointReading(issue, { interval: "2d", outcome: "unavailable", at: after(2) }).issue;
    issue = recordCheckpointReading(issue, { interval: "2d", outcome: "unavailable", at: after(3) }).issue;
    issue = recordCheckpointReading(issue, { interval: "7d", outcome: "agreed", at: after(7) }).issue;
    const last = recordCheckpointReading(issue, { interval: "30d", outcome: "agreed", at: after(30) });
    expect(last.effect).toBe("resolved");
    expect(last.issue.state).toBe("resolved");
  });

  it("says so in history without moving the case", () => {
    const first = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "unavailable",
      at: after(2),
    });
    const { issue } = recordCheckpointReading(first.issue, {
      interval: "2d",
      outcome: "unavailable",
      at: after(3),
    });
    const entry = issue.history.at(-1);
    expect(entry).toMatchObject({
      from: "fixed",
      to: "fixed",
      reason: "2-day check unavailable — the page did not answer.",
    });
  });
});

/* ── Rules 3 and 5 — only the 30-day check resolves ─────────────────────── */

describe("agreement", () => {
  it("resolves when every reading agreed and the 30-day check is in", () => {
    let issue = fixedCase();
    issue = recordCheckpointReading(issue, { interval: "2d", outcome: "agreed", at: after(2) }).issue;
    issue = recordCheckpointReading(issue, { interval: "7d", outcome: "agreed", at: after(7) }).issue;
    const last = recordCheckpointReading(issue, { interval: "30d", outcome: "agreed", at: after(30) });

    expect(last.effect).toBe("resolved");
    expect(last.issue.state).toBe("resolved");
    // It leaves Watch.
    expect(queueOf(last.issue.state)).not.toBe("watch");
    expect(last.issue.history.at(-1)).toMatchObject({
      to: "resolved",
      actor: "system",
      reason: "Resolved — the 30-day check agreed.",
    });
  });

  it("does not resolve on the 2 or 7-day check", () => {
    // Rule 5: holding takes the full thirty days.
    let issue = fixedCase();
    const two = recordCheckpointReading(issue, { interval: "2d", outcome: "agreed", at: after(2) });
    expect(two.effect).toBe("recorded");
    expect(two.issue.state).toBe("fixed");
    const seven = recordCheckpointReading(two.issue, { interval: "7d", outcome: "agreed", at: after(7) });
    expect(seven.effect).toBe("recorded");
    expect(seven.issue.state).toBe("fixed");
    issue = seven.issue;
    expect(queueOf(issue.state)).toBe("watch");
  });

  it("never resolves a case a checkpoint disagreed with", () => {
    // Unreachable through the evaluator — a disagreement reopens immediately —
    // but the guard is what makes that a fact rather than an ordering accident.
    const disagreedEarlier = fixedCase({
      checkpoints: [
        { interval: "2d", result: "disagreed" },
        { interval: "7d", result: "agreed" },
        { interval: "30d", result: "scheduled" },
      ],
    });
    const last = recordCheckpointReading(disagreedEarlier, {
      interval: "30d",
      outcome: "agreed",
      at: after(30),
    });
    expect(last.effect).toBe("recorded");
    expect(last.issue.state).toBe("fixed");
  });

  it("is fired by the system, never by a person", () => {
    let issue = fixedCase();
    issue = recordCheckpointReading(issue, { interval: "30d", outcome: "agreed", at: after(30) }).issue;
    expect(issue.history.at(-1)?.actor).toBe("system");
  });
});

/* ── Rule 4 — three failures to read resolve nothing ───────────────────── */

describe("three unavailable readings", () => {
  /** Every checkpoint read twice, failing both times. */
  function allUnavailable(): IssueCase {
    let issue = fixedCase();
    for (const interval of ["2d", "7d", "30d"] as const) {
      issue = recordCheckpointReading(issue, { interval, outcome: "unavailable", at: after(2) }).issue;
      issue = recordCheckpointReading(issue, { interval, outcome: "unavailable", at: after(3) }).issue;
    }
    return issue;
  }

  it("leaves the case fixed, in Watch", () => {
    const issue = allUnavailable();
    expect(issue.state).toBe("fixed");
    expect(queueOf(issue.state)).toBe("watch");
  });

  it("does not resolve and does not reopen", () => {
    const issue = allUnavailable();
    expect(issue.history.some((entry) => entry.to === "resolved")).toBe(false);
    expect(issue.history.some((entry) => entry.to === "reopened")).toBe(false);
  });

  it("is what the actionable row is keyed on", () => {
    expect(noReadingTaken(allUnavailable())).toBe(true);
    expect(noReadingTaken(fixedCase())).toBe(false);
    // One reading taken is not none.
    const partly = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "agreed",
      at: after(2),
    }).issue;
    expect(noReadingTaken(partly)).toBe(false);
  });

  it("has no scheduled check left, so the row shows no countdown", () => {
    expect(nextScheduled(allUnavailable())).toBeNull();
  });
});

/* ── The queue's order ──────────────────────────────────────────────────── */

describe("Watch order", () => {
  it("puts the next check due first", () => {
    const soon = fixedCase({ id: "PW-soon", checkpoints: scheduleCheckpoints(after(20)) });
    const later = fixedCase({ id: "PW-later", checkpoints: scheduleCheckpoints(after(25)) });
    expect([later, soon].sort(byNextDue).map((item) => item.id)).toEqual(["PW-soon", "PW-later"]);
  });

  it("sorts a case with nothing scheduled last", () => {
    // Rule 18: an absent reading is not an early one.
    const nothingLeft = fixedCase({
      id: "PW-none",
      checkpoints: [{ interval: "30d", result: "unavailable" }],
    });
    const waiting = fixedCase({ id: "PW-waiting" });
    expect([nothingLeft, waiting].sort(byNextDue).map((item) => item.id)).toEqual([
      "PW-waiting",
      "PW-none",
    ]);
  });

  it("follows the retried due date rather than the interval's name", () => {
    // A 2-day checkpoint retried at +24h is due after the 7-day one's original
    // slot only if the retry pushed it there; either way the countdown names
    // whichever is soonest, which is what the due date says and the label
    // does not.
    const retried = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "unavailable",
      at: after(6.5),
    }).issue;
    expect(nextScheduled(retried)?.interval).toBe("7d");
  });
});

/* ── Registry parity, and the single reader ─────────────────────────────── */

describe("the evaluator and the registry", () => {
  it("implements the rules the registry decided, unedited", () => {
    expect([...CHECKPOINT_EVALUATION]).toEqual(registry.concepts.checkpoint.evaluation);
  });

  it("is the only thing in src/ that reads a checkpoint result", () => {
    /**
     * A second reader is how the five rules drift: one place reopens on a
     * disagreement and another quietly treats it as a failed check. The row and
     * the track ask this module what the run says; they never branch on
     * `result` themselves.
     */
    const allowed = new Set([
      "lib/checkpoint-evaluation.ts",
      // The predicate rule 3 and 5 are enforced by, and the schedule that
      // writes the initial `scheduled`.
      "lib/issue-case.ts",
      // Names the four values; assigns no meaning to them.
      "lib/vocabulary.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full, rel);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || allowed.has(rel)) continue;
        const code = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        // Comparing a checkpoint's result against one of the four values.
        if (/result\s*===\s*"(agreed|disagreed|unavailable|scheduled)"/.test(code)) {
          offenders.push(rel);
        }
      }
    };
    walk(path.resolve(moduleDir, "../../"), "");
    expect(offenders, "should ask checkpoint-evaluation instead of reading result").toEqual([]);
  });

  it("marks the unavailable line as a note rather than a move", () => {
    /**
     * The entry carries `fixed` on both sides, so a renderer that assumes every
     * entry is a transition would draw "Fixed → Fixed". `isTransition` is the
     * question to ask instead, and it is asked rather than reimplemented — see
     * the guard below, which is what keeps that true once the case view exists.
     */
    const first = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "unavailable",
      at: after(2),
    });
    const { issue } = recordCheckpointReading(first.issue, {
      interval: "2d",
      outcome: "unavailable",
      at: after(3),
    });
    const note = issue.history.at(-1)!;
    expect(isTransition(note)).toBe(false);
    // The reopen and resolve lines are moves, and must still read as moves.
    const reopened = recordCheckpointReading(fixedCase(), {
      interval: "2d",
      outcome: "disagreed",
      at: after(2),
    }).issue;
    expect(isTransition(reopened.history.at(-1)!)).toBe(true);
    // Migrated history, whose origin was never recorded, is still a move.
    expect(isTransition({ at: after(1), to: "fixed", actor: "system" })).toBe(true);
  });

  it("leaves no component to work out what a note is for itself", () => {
    /**
     * The same shape as the single-reader rule above, and for the same reason.
     * The case view does not exist yet (S2 builds it), so this is the mechanism
     * that stops the arrow being drawn on a note before there is anything to
     * review — a comment asking the next editor to remember is not a mechanism.
     */
    const offenders: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full, rel);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || rel === "lib/issue-case.ts") continue;
        const code = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        // Comparing an entry's two ends instead of asking `isTransition`.
        if (/\.from\s*[!=]==\s*\w*\.?to\b|\.to\s*[!=]==\s*\w*\.?from\b/.test(code)) {
          offenders.push(rel);
        }
      }
    };
    walk(path.resolve(moduleDir, "../../"), "");
    expect(offenders, "should ask isTransition instead of comparing from and to").toEqual([]);
  });

  it("refuses a reading for a checkpoint nobody scheduled", () => {
    const noSchedule = fixedCase({ checkpoints: [] });
    expect(() =>
      recordCheckpointReading(noSchedule, { interval: "2d", outcome: "agreed", at: after(2) }),
    ).toThrow(IssueCaseError);
  });
});
