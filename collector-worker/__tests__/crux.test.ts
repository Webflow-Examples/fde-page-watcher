import { describe, expect, it, vi } from "vitest";
import { collectCruxEvidence } from "../crux";

function response(
  target: "url" | "origin",
  formFactor: "PHONE" | "DESKTOP",
) {
  const metric = (p75: number | string) => ({
    percentilesTimeseries: { p75s: [p75] },
    histogramTimeseries: [{ start: 0, densities: [1] }],
  });
  return {
    record: {
      key: {
        [target]: target === "url" ? "https://example.com/page" : "https://example.com",
        formFactor,
      },
      metrics: {
        largest_contentful_paint: metric(2100),
        interaction_to_next_paint: metric(180),
        cumulative_layout_shift: metric("0.12"),
        experimental_time_to_first_byte: metric(650),
      },
      collectionPeriods: [{
        firstDate: { year: 2026, month: 6, day: 29 },
        lastDate: { year: 2026, month: 7, day: 26 },
      }],
    },
  };
}

function environment(pages = [
  {
    id: "page-one",
    title: "One",
    url: "https://example.com/page",
    flag: "watching",
    status: "pending",
    current: {
      mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 },
      desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
    },
    history: [],
    markers: [],
    agent: [],
  },
]) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const prepare = (sql: string) => ({
    bind: (...values: unknown[]) => {
      const statement = {
        sql,
        values,
        first: async () => sql.startsWith("SELECT json, version, updated_at FROM state")
          ? {
              json: JSON.stringify({ pages, recs: [], jobs: [], followUps: [] }),
              version: 1,
              updated_at: "2026-07-27T00:00:00.000Z",
            }
          : null,
        run: async () => {
          statements.push({ sql, values });
          return { success: true, meta: { rows_written: 1 } };
        },
      };
      return statement;
    },
  });
  const DB = {
    prepare,
    batch: async (batch: Array<{ sql: string; values: unknown[] }>) => {
      statements.push(...batch.map((statement) => ({
        sql: statement.sql,
        values: statement.values,
      })));
      return batch.map(() => ({ success: true, meta: { rows_written: 1 } }));
    },
  };
  const puts: Array<{ key: string; value: string }> = [];
  const REPORTS = {
    put: async (key: string, value: string) => {
      puts.push({ key, value });
      return {};
    },
  };
  return {
    env: {
      DB,
      REPORTS,
      CRUX_API_KEY: "test-key",
      NIGHTLY_TENANT: "brand-studio:live",
    },
    statements,
    puts,
  };
}

describe("CrUX collector", () => {
  it("captures both form factors, falls back only where needed, and writes R2 before D1 snapshots", async () => {
    const { env, statements, puts } = environment();
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        url?: string;
        origin?: string;
        formFactor: "PHONE" | "DESKTOP";
      };
      if (body.url && body.formFactor === "DESKTOP") {
        return new Response(JSON.stringify({
          error: { code: 404, status: "NOT_FOUND", message: "not found" },
        }), { status: 404 });
      }
      return new Response(JSON.stringify(response(body.url ? "url" : "origin", body.formFactor)));
    });

    const result = await collectCruxEvidence(env as never, {
      fetchFn,
      now: new Date("2026-07-27T06:15:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      pages: 1,
      targets: 2,
      available: 2,
      errors: 0,
      snapshotsUpserted: 2,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(puts).toHaveLength(2);
    expect(puts.some((item) => item.key.endsWith("-url.json"))).toBe(true);
    expect(puts.some((item) => item.key.endsWith("-origin.json"))).toBe(true);
    expect(statements.filter((item) => item.sql.startsWith("INSERT INTO crux_snapshots"))).toHaveLength(2);
  });

  it("deduplicates origin queries shared by pages on the same origin", async () => {
    const { env } = environment([
      {
        id: "page-one",
        title: "One",
        url: "https://example.com/one",
        flag: "watching",
        status: "pending",
        current: {
          mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 },
          desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
        },
        history: [],
        markers: [],
        agent: [],
      },
      {
        id: "page-two",
        title: "Two",
        url: "https://example.com/two",
        flag: "watching",
        status: "pending",
        current: {
          mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 },
          desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
        },
        history: [],
        markers: [],
        agent: [],
      },
    ]);
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        url?: string;
        formFactor: "PHONE" | "DESKTOP";
      };
      return body.url
        ? new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 })
        : new Response(JSON.stringify(response("origin", body.formFactor)));
    });

    const result = await collectCruxEvidence(env as never, { fetchFn });

    expect(result.available).toBe(4);
    expect(fetchFn).toHaveBeenCalledTimes(6);
    const originCalls = fetchFn.mock.calls.filter(([, init]) =>
      JSON.parse(String(init?.body)).origin);
    expect(originCalls).toHaveLength(2);
  });

  it("can collect one page independently for a page workflow", async () => {
    const { env, puts } = environment([
      {
        id: "page-one",
        title: "One",
        url: "https://example.com/one",
        flag: "watching",
        status: "pending",
        current: {
          mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 },
          desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
        },
        history: [],
        markers: [],
        agent: [],
      },
      {
        id: "page-two",
        title: "Two",
        url: "https://example.com/two",
        flag: "watching",
        status: "pending",
        current: {
          mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 },
          desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
        },
        history: [],
        markers: [],
        agent: [],
      },
    ]);
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { formFactor: "PHONE" | "DESKTOP" };
      return new Response(JSON.stringify(response("url", body.formFactor)));
    });

    const result = await collectCruxEvidence(env as never, {
      fetchFn,
      tenant: "brand-studio:live",
      pageIds: ["page-two"],
    });

    expect(result).toMatchObject({ pages: 1, targets: 2, available: 2, errors: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(puts).toHaveLength(2);
    expect(puts.every((item) => item.key.includes("/page-two/"))).toBe(true);
  });
});
