import { afterEach, describe, expect, it, vi } from "vitest";
import { scanPageContent } from "../agentReadiness";
import {
  detectNativeWebflowElements,
  mergeNativeElementScans,
  nativeElementIssuesForPage,
  nativeElementScan,
  nativeRecommendationOpportunities,
  siteNativeElementRollups,
  unavailableNativeElementScan,
} from "../nativeElements";
import type { NativeElementFinding, Night, WatchPage } from "../types";

afterEach(() => vi.unstubAllGlobals());

const score = { m: 80, lo: 78, hi: 82 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function scanNight(i: number, findings?: NativeElementFinding[], unavailable = false): Night {
  return {
    i,
    date: `Aug ${i + 1}`,
    scores,
    nativeElements: findings === undefined && !unavailable
      ? undefined
      : unavailable
        ? unavailableNativeElementScan("page unreachable")
        : { status: "available", findings: findings ?? [] },
  };
}

describe("native Webflow element detection", () => {
  const html = `<!doctype html><html><body>
    <div class="hero w-background-video" data-video-urls="hero.mp4,hero.webm"></div>
    <iframe src="https://www.youtube.com/embed/abc"></iframe>
    <iframe src="https://player.vimeo.com/video/123" loading="lazy"></iframe>
    <div data-animation-type="lottie" data-src="animation.json"></div>
    <div class="spline-scene" data-animation-type="spline"></div>
    <img src="https://cdn.prod.website-files.com/site/hero.jpg">
    <img src="https://cdn.prod.website-files.com/site/card.png" srcset="card-500.png 500w">
    <img src="https://cdn.prod.website-files.com/site/icon.svg">
    <img src="https://assets.website-files.com/site/pixel.gif" width="1" height="1">
  </body></html>`;

  it("detects known native footprints without retaining page URLs or attributes", () => {
    const findings = detectNativeWebflowElements(html);
    expect(findings.map((item) => item.id)).toEqual([
      "webflow-background-video",
      "webflow-video-embed-eager",
      "webflow-lottie-eager",
      "webflow-spline-eager",
      "webflow-image-unresponsive",
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "webflow-background-video", count: 1, signals: ["w-background-video", "MP4 and WebM sources"], evidence: expect.arrayContaining([{ label: "eager-loading instances", count: 1 }]), confidence: "high" }),
      expect.objectContaining({ id: "webflow-video-embed-eager", count: 1, webflow: expect.objectContaining({ metric: "TBT", remediation: "partial" }) }),
      expect.objectContaining({ id: "webflow-image-unresponsive", count: 1, evidence: expect.arrayContaining([{ label: "without responsive candidates", count: 1 }]), confidence: "medium", webflow: expect.objectContaining({ remediation: "available" }) }),
    ]));
    expect(JSON.stringify(findings)).not.toContain("youtube.com");
    expect(JSON.stringify(findings)).not.toContain("hero.jpg");
  });

  it("tracks repeated same-provider embeds and duplicate player SDK tags separately", () => {
    const findings = detectNativeWebflowElements(`
      <iframe src="https://www.youtube.com/embed/one"></iframe>
      <iframe src="https://www.youtube.com/embed/two" loading="lazy"></iframe>
      <script src="https://player.vimeo.com/api/player.js"></script>
      <script src="https://player.vimeo.com/api/player.js"></script>
    `);
    expect(findings.find((item) => item.id === "webflow-video-embed-duplicate")).toMatchObject({
      count: 2,
      evidence: expect.arrayContaining([
        { label: "redundant same-provider embeds", count: 1 },
        { label: "duplicate provider SDK tags", count: 1 },
        { label: "providers repeated", count: 2 },
      ]),
      webflow: { metric: "TBT", culprit: "video-embeds", remediation: "partial" },
    });
    expect(JSON.stringify(findings)).not.toContain("youtube.com");
    expect(JSON.stringify(findings)).not.toContain("vimeo.com");
  });

  it("marks unreachable page-content scans unavailable instead of clean", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const result = await scanPageContent("https://example.test");
    expect(result.nativeElements).toEqual({ status: "unavailable", findings: [], reason: "page unreachable" });
    expect(result.agent.every((check) => check.unavailable)).toBe(true);
  });

  it("adds rendered findings without discarding server-HTML evidence", () => {
    const server = nativeElementScan('<div class="w-background-video"></div>');
    const rendered = nativeElementScan(`
      <div class="w-background-video"></div>
      <div class="w-background-video"></div>
      <div data-animation-type="lottie"></div>
    `);

    expect(mergeNativeElementScans(server, rendered)).toMatchObject({
      status: "available",
      findings: expect.arrayContaining([
        expect.objectContaining({ id: "webflow-background-video", count: 2 }),
        expect.objectContaining({ id: "webflow-lottie-eager", count: 1 }),
      ]),
    });
    expect(mergeNativeElementScans(server, unavailableNativeElementScan("render failed"))).toEqual(server);
  });

  it("applies confirmed lifecycle rules while skipping unavailable scans", () => {
    const background = nativeElementScan(html).findings.find((item) => item.id === "webflow-background-video")!;
    const issues = nativeElementIssuesForPage([
      scanNight(0, [background]),
      scanNight(1, undefined, true),
      scanNight(2, []),
      scanNight(3, []),
      scanNight(4, [background]),
    ]);
    expect(issues.find((item) => item.id === background.id)).toMatchObject({
      status: "regressed",
      observedCaptures: 2,
      eligibleCaptures: 4,
      returnedAt: { date: "Aug 5" },
      resolutionCount: 1,
    });
  });

  it("creates device-neutral recommendations and site-wide element rollups", () => {
    const scan = nativeElementScan(html);
    expect(nativeRecommendationOpportunities(scan)[0]).toMatchObject({
      id: "webflow-background-video",
      strategies: ["mobile", "desktop"],
      savingsMs: 0,
    });
    const page = {
      id: "home",
      title: "Homepage",
      url: "https://example.test",
      history: [scanNight(0, scan.findings)],
    } as WatchPage;
    expect(siteNativeElementRollups([page])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "webflow-background-video", pageCount: 1, instanceCount: 1 }),
      expect.objectContaining({ id: "webflow-image-unresponsive", pageCount: 1, instanceCount: 1 }),
    ]));
  });

  it("keeps acknowledged findings visible while suppressing noise and future recommendations", () => {
    const scan = nativeElementScan(html);
    const controls = {
      "webflow-background-video": { disposition: "suppressed" as const, updatedAt: "2026-08-03T12:00:00.000Z" },
      "webflow-image-unresponsive": { disposition: "acknowledged" as const, updatedAt: "2026-08-03T12:00:00.000Z" },
    };
    expect(nativeRecommendationOpportunities(scan, controls).map((item) => item.id)).not.toEqual(expect.arrayContaining([
      "webflow-background-video",
      "webflow-image-unresponsive",
    ]));

    const page = {
      id: "home",
      title: "Homepage",
      url: "https://example.test",
      history: [scanNight(0, scan.findings)],
      nativeElementControls: controls,
    } as WatchPage;
    const rollups = siteNativeElementRollups([page]);
    expect(rollups.some((item) => item.id === "webflow-background-video")).toBe(false);
    expect(rollups.find((item) => item.id === "webflow-image-unresponsive")).toMatchObject({ acknowledgedCount: 1 });
  });
});
