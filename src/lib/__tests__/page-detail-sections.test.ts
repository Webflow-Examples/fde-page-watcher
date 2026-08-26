import { describe, expect, it } from "vitest";
import {
  PAGE_DETAIL_JUMP_LABEL,
  PAGE_DETAIL_JUMP_SOURCE,
  PAGE_DETAIL_JUMP_TARGET,
  PAGE_DETAIL_SECTIONS,
  PAGE_DETAIL_SECTION_HEADING,
  pageDetailAnchor,
} from "../page-detail-sections";

/**
 * The page detail's reading order.
 *
 * There is no DOM in this suite, and the order is assertable without one
 * because the order is DATA: `page/[id]` maps this array over a record of
 * section views, so nothing else in the file can decide what comes first. The
 * alternative — rendering the page and reading the document back — would have
 * meant adding jsdom, a lockfile change `AGENTS.md` warns against, to observe a
 * property that is right here in plain form.
 *
 * The literal below is the decision, not a mirror of one. Rule 21 forbids
 * asserting a literal that `vocabulary.json` also names; reading order is not
 * in the registry, this array is its only statement in `src/`, and this test is
 * the mechanism that pins it. Reorder the array and this fails.
 */

describe("page detail reading order", () => {
  it("is status, then open cases, then every reading", () => {
    expect([...PAGE_DETAIL_SECTIONS]).toEqual(["status", "cases", "readings"]);
  });

  it("names every section exactly once", () => {
    expect(new Set(PAGE_DETAIL_SECTIONS).size).toBe(PAGE_DETAIL_SECTIONS.length);
  });

  it("gives every section a heading, and heads nothing it does not render", () => {
    // A section with no heading arrives here as a missing key rather than as a
    // band of content with no name on it.
    expect(Object.keys(PAGE_DETAIL_SECTION_HEADING).sort()).toEqual([...PAGE_DETAIL_SECTIONS].sort());
  });
});

describe("the jump link", () => {
  /**
   * The two halves of one decision, checked against each other rather than
   * against copies of themselves: the strip carries a link, the readings
   * section carries the anchor, and the order decides whether the link goes
   * forward. A jump link that points at a section above it is a scroll
   * backwards, which is not what a jump link is for.
   */
  it("points forward, from a section that exists to a section that exists", () => {
    const from = PAGE_DETAIL_SECTIONS.indexOf(PAGE_DETAIL_JUMP_SOURCE);
    const to = PAGE_DETAIL_SECTIONS.indexOf(PAGE_DETAIL_JUMP_TARGET);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
  });

  it("is named for the section it lands on", () => {
    expect(PAGE_DETAIL_JUMP_LABEL).toContain(PAGE_DETAIL_SECTION_HEADING[PAGE_DETAIL_JUMP_TARGET]);
  });

  it("targets the anchor the section carries", () => {
    // One function builds both, so the fragment and the id cannot drift.
    expect(pageDetailAnchor(PAGE_DETAIL_JUMP_TARGET)).toBe("page-detail-readings");
  });
});
