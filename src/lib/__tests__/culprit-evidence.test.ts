import { describe, expect, it } from "vitest";
import { culpritEvidenceTrends, summarizeCulpritEvidence } from "../culpritEvidence";
import type { CulpritEvidence, Night } from "../types";

const score = { m: 80, lo: 78, hi: 82 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function report(offset = 0, warnings: string[] = []) {
  return {
    lighthouseResult: {
      runWarnings: warnings,
      audits: {
        "dom-size": { details: { items: [
          { statistic: "Total DOM Elements", value: 1_200 + offset },
          { statistic: "Maximum DOM Depth", value: 26 },
          { statistic: "Maximum Child Elements", value: 48 },
        ] } },
        "unused-css-rules": { details: {
          overallSavingsBytes: 150_000 + offset,
          items: [{ url: "https://customer.example/private/site.css?token=secret", totalBytes: 300_000, wastedBytes: 150_000 + offset }],
        } },
        "unminified-javascript": { details: {
          overallSavingsBytes: 42_000 + offset,
          items: [{ url: "https://example.test/private/custom.js", totalBytes: 100_000, wastedBytes: 42_000 + offset }],
        } },
        "legacy-javascript": { details: {
          overallSavingsBytes: 28_000 + offset,
          items: [{ url: "https://example.test/private/legacy.js", totalBytes: 80_000, wastedBytes: 28_000 + offset }],
        } },
        "third-party-summary": { details: { items: [
          { url: "https://www.googletagmanager.com/gtm.js?id=private", transferSize: 120_000, mainThreadTime: 220, blockingTime: 80 + offset },
        ] } },
        "render-blocking-resources": { details: {
          overallSavingsMs: 600 + offset,
          items: [{ url: "https://fonts.googleapis.com/private.css", totalBytes: 12_000, wastedMs: 600 }],
        } },
        "uses-responsive-images": { details: {
          overallSavingsBytes: 400_000 + offset,
          items: [{ url: "https://cdn.prod.website-files.com/private/hero.jpg", totalBytes: 700_000, wastedBytes: 400_000 + offset }],
        } },
        "largest-contentful-paint-element": { details: { items: [{
          url: "https://cdn.prod.website-files.com/private/hero.jpg?customer=secret",
          node: { snippet: "<img class=\"customer-secret\" alt=\"private campaign\">", selector: "main > .private", boundingRect: { width: 1_440, height: 810 } },
        }] } },
      },
    },
  };
}

function night(i: number, evidence: CulpritEvidence[]): Night {
  return { i, date: `Aug ${i + 1}`, scores, culpritEvidence: { mobile: evidence } };
}

describe("culprit evidence", () => {
  it("extracts median structured evidence without retaining paths, selectors, snippets, or page text", () => {
    const evidence = summarizeCulpritEvidence([report(0), report(20)]);
    expect(evidence.find((item) => item.auditId === "dom-size")).toMatchObject({
      facts: expect.arrayContaining([expect.objectContaining({ key: "nodes", value: 1_210, unit: "count" })]),
      sampleRuns: 2,
    });
    expect(evidence.find((item) => item.auditId === "unused-css-rules")).toMatchObject({
      facts: expect.arrayContaining([expect.objectContaining({ key: "wastedBytes", value: 150_010, unit: "bytes" })]),
    });
    expect(evidence.find((item) => item.auditId === "unminified-javascript")).toMatchObject({
      facts: expect.arrayContaining([
        expect.objectContaining({ key: "resources", value: 1 }),
        expect.objectContaining({ key: "wastedBytes", value: 42_010, unit: "bytes" }),
      ]),
    });
    expect(evidence.find((item) => item.auditId === "legacy-javascript")).toMatchObject({
      facts: expect.arrayContaining([expect.objectContaining({ key: "wastedBytes", value: 28_010, unit: "bytes" })]),
    });
    expect(evidence.find((item) => item.auditId === "third-party-summary")).toMatchObject({
      sources: [{ host: "googletagmanager.com", transferBytes: 120_000, blockingMs: 90 }],
    });
    expect(evidence.find((item) => item.auditId === "largest-contentful-paint-element")).toMatchObject({
      lcpElement: { elementType: "img", assetHost: "cdn.prod.website-files.com", width: 1_440, height: 810 },
    });

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("/private/");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("customer-secret");
    expect(serialized).not.toContain("private campaign");
    expect(serialized).not.toContain("selector");
  });

  it("excludes warned reports and derives snapshot deltas from retained history", () => {
    const first = summarizeCulpritEvidence([report(0), report(9_999, ["Page loaded too slowly"])]);
    const second = summarizeCulpritEvidence([report(100)]);
    expect(first.find((item) => item.auditId === "dom-size")?.facts.find((item) => item.key === "nodes")?.value).toBe(1_200);

    const dom = culpritEvidenceTrends([night(0, first), night(1, second)], "mobile")
      .find((item) => item.evidence.auditId === "dom-size");
    expect(dom).toMatchObject({ series: [1_200, 1_300], delta: 100, primary: { key: "nodes" } });
  });
});
