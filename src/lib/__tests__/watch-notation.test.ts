import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markShapesOf, runOf } from "../checkpoint-evaluation";
import { markFixed, type Checkpoint, type IssueCase } from "../issue-case";
import type { Caller } from "../caller";

/**
 * The notation's invariants (13a, 14c, 15d).
 *
 * There is no DOM in this suite and adding one for four assertions would mean a
 * new dependency and a regenerated lockfile, so the properties that live in the
 * markup are read out of the source the way `token-contrast.test.ts` reads the
 * stylesheet. That is weaker than rendering, and it is honest about which four
 * things it is pinning: the sizes, the equal segments, the single pill, and the
 * absence of hue as the only difference between agreed and disagreed.
 */

const MARKS = readFileSync(join(process.cwd(), "src/components/checkpoint-marks.tsx"), "utf8");
const TRACK = readFileSync(join(process.cwd(), "src/components/checkpoint-track.tsx"), "utf8");
const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const FIXED_AT = "2026-08-01T00:00:00.000Z";
const PERSON: Caller = { kind: "person", userId: "rae@webflow.com" };

function fixed(checkpoints?: Checkpoint[]): IssueCase {
  const base: IssueCase = {
    id: "PW-1",
    cause: "c",
    state: "in_progress",
    title: "t",
    diagnosis: "d",
    detectedAt: FIXED_AT,
    confirmedRuns: 1,
    scope: "page",
    pageIds: ["p1"],
    strategies: ["mobile"],
    impactMs: 0,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: ["s"], actionability: "direct" },
    successCriteria: "s",
    checkpoints: [],
    evidence: [],
    history: [],
  };
  const marked = markFixed(base, { by: PERSON, at: FIXED_AT });
  return checkpoints ? { ...marked, checkpoints } : marked;
}

/* ── 13a — four silhouettes, colour removable ───────────────────────────── */

describe("the four marks", () => {
  it("gives each outcome its own silhouette", () => {
    // Four distinct shapes, so the run survives being read in greyscale.
    const shapes = markShapesOf();
    expect(new Set(Object.values(shapes)).size).toBe(4);
  });

  it("does not separate agreed from disagreed by hue", () => {
    /**
     * The check and the cross are the pair most likely to be "improved" into a
     * green tick and a red cross. Both are drawn with the same two tokens — the
     * disc and the glyph on it — so there is no hue to remove, and the greyscale
     * check is passed by construction rather than by inspection.
     */
    const glyphMarks = /check: \(\s*<>([\s\S]*?)<\/>\s*\),/.exec(MARKS)?.[1] ?? "";
    const crossMarks = /cross: \(\s*<>([\s\S]*?)<\/>\s*\),/.exec(MARKS)?.[1] ?? "";
    expect(glyphMarks).not.toBe("");
    expect(crossMarks).not.toBe("");
    const tokensIn = (src: string) => [...src.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]).sort();
    expect(tokensIn(glyphMarks)).toEqual(tokensIn(crossMarks));
  });

  it("paints every mark from one neutral family", () => {
    // A hue introduced into any of the three would make one outcome legible in
    // a way the others are not.
    const family = ["--checkpoint-mark-border", "--checkpoint-mark-fill", "--checkpoint-mark-glyph"];
    for (const token of family) {
      expect(CSS, `${token} should be defined`).toMatch(new RegExp(`${token}:`));
    }
    // Every colour the marks file names comes from that family or is the
    // warning tone reserved for "none left".
    const used = new Set([...MARKS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const allowed = new Set([...family, "--status-warning-text", "--status-warning-bg", "--text-body", "--text-muted"]);
    expect([...used].filter((token) => !allowed.has(token))).toEqual([]);
  });

  it("draws marks at 16px, because a glyph in a 9px circle is a smudge", () => {
    expect(MARKS).toMatch(/const MARK_PX = 16;/);
  });
});

/* ── 15d — one pill, in its chronological place ─────────────────────────── */

describe("the countdown pill", () => {
  it("marks exactly one scheduled check as next", () => {
    const run = runOf(fixed());
    expect(run.filter((view) => view.isNext)).toHaveLength(1);
  });

  it("marks it in its chronological position, not first", () => {
    // Two readings in, the pill belongs on the 30-day check — third in the run.
    const run = runOf(
      fixed([
        { interval: "2d", due: "2026-08-03T00:00:00.000Z", result: "agreed" },
        { interval: "7d", due: "2026-08-08T00:00:00.000Z", result: "agreed" },
        { interval: "30d", due: "2026-08-31T00:00:00.000Z", result: "scheduled" },
      ]),
    );
    expect(run.findIndex((view) => view.isNext)).toBe(2);
    expect(run.map((view) => view.interval)).toEqual(["2d", "7d", "30d"]);
  });

  it("marks none when every check has been read", () => {
    const run = runOf(
      fixed([
        { interval: "2d", result: "unavailable" },
        { interval: "7d", result: "unavailable" },
        { interval: "30d", result: "unavailable" },
      ]),
    );
    expect(run.some((view) => view.isNext)).toBe(false);
  });

  it("keeps the collapsed row the same height with or without it", () => {
    /**
     * The pill is 18px and a mark is 16px, so the strip is sized to the taller
     * of the two unconditionally. Otherwise every row that gains a countdown
     * grows by 2px and the list ripples as checks come in.
     */
    expect(MARKS).toMatch(/const PILL_PX = 18;/);
    expect(MARKS).toMatch(/height: PILL_PX,/);
  });

  it("colours its text with ink rather than its own border", () => {
    // neutral-600 at 12px does not clear 4.5:1. The border may be that value;
    // the text may not.
    expect(MARKS).toMatch(/color: empty \? "var\(--status-warning-text\)" : "var\(--text-body\)"/);
    expect(MARKS).not.toMatch(/color:[^;\n]*--checkpoint-mark-border/);
  });

  it("uses a 5px gap between marks", () => {
    expect(MARKS).toMatch(/const GAP_PX = 5;/);
  });
});

/* ── 14c — equal segments ───────────────────────────────────────────────── */

describe("the expanded track", () => {
  it("gives every segment the same width", () => {
    /**
     * Never proportional. 2, 7 and 30 laid out to scale puts the first two
     * checks inside the opening fifth of the track, which is where the reader
     * is looking.
     */
    expect(TRACK).toMatch(/flex: "1 1 0", minWidth: 0/);
    expect(TRACK).not.toMatch(/flexGrow:\s*\w*(days|span|interval)/i);
    // No arithmetic on the intervals to derive a width.
    expect(TRACK).not.toMatch(/width:\s*`?\$\{/);
  });

  it("writes the span into each segment instead of drawing it to scale", () => {
    expect(TRACK).toMatch(/watchTrackSegment\(view\.interval\)/);
  });

  it("reserves no height when closed", () => {
    const ROW = readFileSync(join(process.cwd(), "src/components/watch-row.tsx"), "utf8");
    // The drawer is absent from the tree when closed, not present at height 0.
    expect(ROW).toMatch(/\{open \? \(/);
    expect(ROW).not.toMatch(/(maxHeight|height):\s*open \?/);
  });

  it("opens on click, never on hover", () => {
    const ROW = readFileSync(join(process.cwd(), "src/components/watch-row.tsx"), "utf8");
    expect(ROW).toMatch(/onClick=\{onToggle\}/);
    expect(ROW).not.toMatch(/onMouseEnter|onMouseOver|onPointerEnter/);
  });

  it("grows downward only, and never scripts a scroll", () => {
    /**
     * The drawer is the last child of its own row, so opening it moves the rows
     * below and nothing above. That is what makes closing it restore the
     * reader's position for free — there is no position to restore, because
     * nothing above the row ever moved. A `scrollIntoView` here would be a
     * correction for a problem the layout does not have, and would fight the
     * reader for control of the viewport.
     */
    const ROW = readFileSync(join(process.cwd(), "src/components/watch-row.tsx"), "utf8");
    const QUEUE = readFileSync(join(process.cwd(), "src/components/watch-queue.tsx"), "utf8");
    for (const src of [ROW, QUEUE]) {
      expect(src).not.toMatch(/scrollIntoView|scrollTo|scrollTop|useLayoutEffect/);
    }
    // The drawer follows the row's own content rather than preceding it.
    expect(ROW.indexOf("CheckpointMarks")).toBeLessThan(ROW.indexOf("CheckpointTrack"));
  });
});

/* ── 14b is not in this build ───────────────────────────────────────────── */

describe("the marks-into-track morph", () => {
  it("is not what makes the track comprehensible", () => {
    /**
     * 14c is the state; the morph is a transition into it. The drawer's only
     * motion is an opacity crossfade, and reduced motion switches it off — if
     * the animation were carrying meaning, switching it off would remove some.
     */
    expect(CSS).toMatch(/@keyframes watch-drawer-in \{[\s\S]*?opacity: 0;[\s\S]*?opacity: 1;[\s\S]*?\}/);
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]*?\.watch-drawer,/);
    // No transform, no morph, no position animation.
    const keyframes = /@keyframes watch-drawer-in \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(keyframes).not.toMatch(/transform|translate|scale|height/);
  });
});
