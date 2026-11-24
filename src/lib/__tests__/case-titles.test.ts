import { describe, expect, it } from "vitest";
import { CASE_TITLE_BY_AUDIT_ID, caseTitleFor } from "../case-titles";
import { fromRec } from "../issue-case";
import type { Rec } from "../types";

/**
 * The one decision: a case names a symptom, and the audit id stays the cause.
 */

const STORED: Record<string, string> = {
  "link-name": "Links do not have a discernible name",
  "link-descriptive": "Links do not have descriptive text",
  "heading-order": "Heading elements are not in a sequentially-descending order",
  "label-content-name-mismatch": "Elements with visible text labels do not have matching accessible names",
  "color-contrast": "Background and foreground colors do not have a sufficient contrast ratio",
  "target-size": "Touch targets do not have sufficient size or spacing",
  "errors-in-console": "Browser errors were logged to the console",
  "devtools-issues": "Issues were logged in the Issues panel in Chrome Devtools",
  "crux-field-only-lcp": "Investigate visitor-only content loading",
  "crux-field-only-inp": "Investigate visitor-only interaction delay",
  "crux-field-only-cls": "Investigate visitor-only layout shifts",
  "crux-field-only-ttfb": "Investigate visitor-only server response delay",
};

describe("plain-language case titles", () => {
  it("names a symptom for every raw id the production list holds", () => {
    for (const [id, stored] of Object.entries(STORED)) {
      const title = caseTitleFor(id, stored);
      expect(title, `${id} kept its stored title`).not.toBe(stored);
      expect(title, `${id} still begins with an investigation`).not.toMatch(/^Investigate/);
      expect(title.trim().length, `${id} has no title`).toBeGreaterThan(0);
    }
  });

  it("keeps the id as the cause, so grouping and the library still find it", () => {
    const rec: Rec = {
      key: "home:link-name",
      pageId: "home",
      pageTitle: "Home",
      url: "example.com",
      id: "link-name",
      source: "lighthouse",
      title: "Links do not have a discernible name",
      category: "Accessibility",
      savings: "Observed",
      estTime: "1 day",
      status: "inbox",
      taskStatus: "todo",
      added: "2026-08-02",
      doneDate: null,
    };
    const issue = fromRec(rec);
    expect(issue.cause).toBe("link-name");
    expect(issue.title).toBe(CASE_TITLE_BY_AUDIT_ID["link-name"]);
  });

  it("falls back to the stored title for an unknown id, and to the id when there is none", () => {
    expect(caseTitleFor("some-new-audit", "Some new insight")).toBe("Some new insight");
    expect(caseTitleFor("some-new-audit", undefined)).toBe("some-new-audit");
    // A title that already names a symptom is left alone.
    expect(caseTitleFor("uses-responsive-images", "Images were bigger than the space they fill"))
      .toBe("Images were bigger than the space they fill");
  });
});
