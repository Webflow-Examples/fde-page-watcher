import { describe, expect, it, vi } from "vitest";
import {
  CruxApiError,
  cruxSnapshotStatus,
  parseCruxHistoryResponse,
  queryCruxHistory,
  selectCruxEvidence,
} from "../crux";

function historyResponse(
  scope: "url" | "origin" = "url",
  options: { partial?: boolean; empty?: boolean } = {},
) {
  const metric = (p75s: Array<number | string | null>, densities: Array<number | string>) => ({
    percentilesTimeseries: { p75s },
    histogramTimeseries: [
      { start: 0, end: 1, densities },
      { start: 1, densities: ["NaN"] },
    ],
  });
  return {
    record: {
      key: { [scope]: scope === "url" ? "https://example.com/page" : "https://example.com", formFactor: "PHONE" },
      metrics: options.empty ? {} : {
        largest_contentful_paint: metric([2100], [0.8]),
        interaction_to_next_paint: metric([180], [0.9]),
        cumulative_layout_shift: metric(["0.12"], [0.85]),
        ...(options.partial ? {} : { experimental_time_to_first_byte: metric([650], [0.75]) }),
      },
      collectionPeriods: [{
        firstDate: { year: 2026, month: 6, day: 29 },
        lastDate: { year: 2026, month: 7, day: 26 },
      }],
    },
    urlNormalizationDetails: scope === "url"
      ? { originalUrl: "https://example.com/page#hash", normalizedUrl: "https://example.com/page" }
      : undefined,
  };
}

describe("CrUX history parsing", () => {
  it("normalizes typed p75 values while preserving raw metric values and missing densities", () => {
    const [snapshot] = parseCruxHistoryResponse(historyResponse(), {
      requestedUrl: "example.com/page#hash",
      formFactor: "PHONE",
      scope: "url",
      fetchedAt: "2026-07-27T06:15:00.000Z",
    });

    expect(snapshot).toMatchObject({
      requestedUrl: "https://example.com/page#hash",
      effectiveUrl: "https://example.com/page",
      collectionStart: "2026-06-29",
      collectionEnd: "2026-07-26",
      lcpP75Ms: 2100,
      inpP75Ms: 180,
      clsP75: 0.12,
      ttfbP75Ms: 650,
    });
    expect(snapshot.metrics.cumulative_layout_shift?.p75).toBe("0.12");
    expect(snapshot.metrics.largest_contentful_paint?.histogram[1].density).toBeNull();
    expect(snapshot.urlNormalizationDetails?.normalizedUrl).toBe("https://example.com/page");
    expect(cruxSnapshotStatus(snapshot)).toBe("available");
  });

  it("classifies records with missing requested metrics as partial", () => {
    const [snapshot] = parseCruxHistoryResponse(historyResponse("url", { partial: true }), {
      requestedUrl: "https://example.com/page",
      formFactor: "PHONE",
      scope: "url",
    });
    expect(snapshot.ttfbP75Ms).toBeNull();
    expect(cruxSnapshotStatus(snapshot)).toBe("partial");
  });

  it("rejects responses for a different form factor", () => {
    expect(() => parseCruxHistoryResponse(historyResponse(), {
      requestedUrl: "https://example.com/page",
      formFactor: "DESKTOP",
      scope: "url",
    })).toThrow("form factor");
  });
});

describe("CrUX URL/origin selection", () => {
  it("uses URL evidence without querying the origin", async () => {
    const query = vi.fn(async () => historyResponse());
    const selected = await selectCruxEvidence("https://example.com/page", "PHONE", query);
    expect(selected?.scope).toBe("url");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("falls back to the origin after URL-level insufficient data", async () => {
    const query = vi.fn(async ({ scope }: { scope: "url" | "origin" }) => {
      if (scope === "url") throw new CruxApiError("not found", 404, "NOT_FOUND");
      return historyResponse("origin");
    });
    const selected = await selectCruxEvidence("https://example.com/page", "PHONE", query);
    expect(selected?.scope).toBe("origin");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not hide provider failures with an origin fallback", async () => {
    const query = vi.fn(async () => {
      throw new CruxApiError("rate limited", 429, "RESOURCE_EXHAUSTED");
    });
    await expect(selectCruxEvidence("https://example.com/page", "PHONE", query))
      .rejects.toMatchObject({ status: 429 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns insufficient when neither scope has usable metrics", async () => {
    const query = vi.fn(async ({ scope }: { scope: "url" | "origin" }) =>
      historyResponse(scope, { empty: true }));
    await expect(selectCruxEvidence("https://example.com/page", "PHONE", query))
      .resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("CrUX API requests", () => {
  it("requests only the configured metrics and does not put the API key in the body", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(historyResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    await queryCruxHistory(
      { scope: "url", target: "https://example.com/page", formFactor: "PHONE" },
      { apiKey: "secret-key", fetchFn },
    );
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("key=secret-key");
    expect(String(init?.body)).not.toContain("secret-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      url: "https://example.com/page",
      formFactor: "PHONE",
      collectionPeriodCount: 40,
    });
  });
});
