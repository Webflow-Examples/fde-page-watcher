import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getCachedOraAudit,
  ORA_MAX_POLL_MS,
  ORA_MAX_RESPONSE_BYTES,
  ORA_POLL_INTERVAL_MS,
  OraTransportError,
  scanOraOrigin,
} from "../oraClient";

const ORIGIN = "https://example.com";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(
    path.join(__dirname, "..", "..", "src", "lib", "__tests__", "fixtures", `ora-audit-${name}.json`),
    "utf8",
  )) as Record<string, unknown>;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
  redirect?: RequestRedirect;
}

function recorder(
  responses: Array<Response | ((call: Call) => Response)>,
): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
      authorization: new Headers(init?.headers).get("authorization"),
      ...(init?.redirect ? { redirect: init.redirect } : {}),
    };
    calls.push(call);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof next === "function" ? next(call) : next;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const noSleep = async () => undefined;

describe("Ora cached read", () => {
  it("asks the score route for the audit shape and consumes no scan quota", async () => {
    const { fetchFn, calls } = recorder([Response.json(fixture("complete"))]);
    const outcome = await getCachedOraAudit(ORIGIN, { fetchFn });
    expect(outcome).toMatchObject({ kind: "result", complete: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url)
      .toBe("https://ora.ai/api/score/example.com?format=audit&include=essentials");
    expect(calls[0].body).toBeUndefined();
  });

  it("reports a domain Ora has never scanned", async () => {
    const { fetchFn } = recorder([Response.json(
      { error: "No cached score", code: "DOMAIN_NOT_SCANNED", domain: "example.com" },
      { status: 404 },
    )]);
    await expect(getCachedOraAudit(ORIGIN, { fetchFn }))
      .resolves.toEqual({ kind: "not-scanned", domain: "example.com" });
  });

  it("refuses a staging origin before any request is made", async () => {
    const { fetchFn, calls } = recorder([Response.json(fixture("complete"))]);
    await expect(getCachedOraAudit("https://client.webflow.io", { fetchFn })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("Ora scan", () => {
  it("posts the audit-shaped scan with a clamped freshness window", async () => {
    const { fetchFn, calls } = recorder([Response.json(fixture("complete"))]);
    const { outcome, polls } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "result", complete: true });
    expect(polls).toBe(0);
    expect(calls[0].url).toBe("https://ora.ai/api/scan?format=audit&include=essentials");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ url: "example.com", maxAgeSeconds: 86_400 });
    // Redirects are refused rather than followed to an unknown host.
    expect(calls[0].redirect).toBe("error");
  });

  it("clamps an out-of-range freshness window and passes force through", async () => {
    const { fetchFn, calls } = recorder([Response.json(fixture("complete"))]);
    await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep, maxAgeSeconds: 10, force: true });
    expect(calls[0].body).toEqual({ url: "example.com", maxAgeSeconds: 3_600, force: true });
  });

  it("sends a bearer token only when a key is configured", async () => {
    const keyless = recorder([Response.json(fixture("complete"))]);
    await scanOraOrigin(ORIGIN, { fetchFn: keyless.fetchFn, sleep: noSleep });
    expect(keyless.calls[0].authorization).toBeNull();

    const keyed = recorder([Response.json(fixture("complete"))]);
    await scanOraOrigin(ORIGIN, { fetchFn: keyed.fetchFn, sleep: noSleep, apiKey: "partner-key" });
    expect(keyed.calls[0].authorization).toBe("Bearer partner-key");
  });

  it("polls the provider's own Location URL until the analysis completes", async () => {
    const { fetchFn, calls } = recorder([
      Response.json(fixture("partial"), {
        status: 202,
        headers: { location: "/api/score/example.com" },
      }),
      Response.json(fixture("partial")),
      Response.json(fixture("complete")),
    ]);
    const { outcome, polls } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "result", complete: true });
    expect(polls).toBe(2);
    expect(calls[1].url)
      .toBe("https://ora.ai/api/score/example.com?format=audit&include=essentials");
    expect(calls[2].url).toBe(calls[1].url);
  });

  it("caps total polling and returns the partial reading as real evidence", async () => {
    const { fetchFn, calls } = recorder([
      Response.json(fixture("partial"), {
        status: 202,
        headers: { location: "/api/score/example.com" },
      }),
      // A factory, so every poll gets an unconsumed body.
      () => Response.json(fixture("partial")),
    ]);
    let clock = 0;
    const { outcome, polls } = await scanOraOrigin(ORIGIN, {
      fetchFn,
      sleep: async () => { clock += ORA_POLL_INTERVAL_MS; },
      now: () => clock,
    });
    expect(outcome).toMatchObject({ kind: "result", complete: false });
    // Sleeps exactly to the budget and no further.
    expect(polls).toBe(ORA_MAX_POLL_MS / ORA_POLL_INTERVAL_MS);
    expect(clock).toBe(ORA_MAX_POLL_MS);
    expect(calls.length).toBe(polls + 1);
  });

  it("does not poll when the provider sends no usable Location", async () => {
    const { fetchFn, calls } = recorder([Response.json(fixture("partial"), {
      status: 202,
      headers: { location: "https://evil.test/api/score/example.com" },
    })]);
    const { outcome, polls } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "result", complete: false });
    expect(polls).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("keeps the partial reading when a poll is rate-limited", async () => {
    const { fetchFn } = recorder([
      Response.json(fixture("partial"), {
        status: 202,
        headers: { location: "/api/score/example.com" },
      }),
      Response.json({ error: "Rate limited", retry_after_ms: 60_000 }, {
        status: 429,
        headers: { "retry-after": "60" },
      }),
    ]);
    const { outcome, polls } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    // Partial evidence survives; the failed poll does not discard it.
    expect(outcome).toMatchObject({ kind: "result", complete: false });
    expect(polls).toBe(1);
  });

  it("surfaces a quota denial with the provider's cooldown", async () => {
    const { fetchFn } = recorder([Response.json(
      { error: "Daily scan limit reached (30 per day).", retry_after_ms: 14_400_000 },
      { status: 429, headers: { "retry-after": "14400" } },
    )]);
    const { outcome } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 14_400 });
  });

  it("classifies a provider failure as retryable without touching the site verdict", async () => {
    for (const status of [500, 502, 503]) {
      const { fetchFn } = recorder([Response.json({ error: "Scan failed" }, { status })]);
      const { outcome } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
      expect(outcome).toMatchObject({ kind: "provider-error", status, retryable: true });
    }
  });

  it("reports a timeout as a retryable transport error", async () => {
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      init?.signal?.throwIfAborted?.();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep }))
      .rejects.toBeInstanceOf(OraTransportError);
    await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep }).catch((error) => {
      expect((error as OraTransportError).retryable).toBe(true);
    });
  });

  it("reports a network failure as a transport error", async () => {
    const fetchFn = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    await expect(scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep }))
      .rejects.toBeInstanceOf(OraTransportError);
  });

  it("treats an unparseable body as no body, keeping the HTTP status", async () => {
    const { fetchFn } = recorder([new Response("<html>gateway</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    })]);
    const { outcome } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    expect(outcome).toEqual({ kind: "provider-error", status: 502, retryable: true });
  });

  it("refuses a body larger than the response ceiling", async () => {
    const { fetchFn } = recorder([Response.json(fixture("complete"), {
      headers: { "content-length": String(ORA_MAX_RESPONSE_BYTES + 1) },
    })]);
    const { outcome } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    // A 200 with a discarded body is a result with nothing usable in it; the
    // parser rejects it rather than the client inventing a reading.
    expect(outcome).toMatchObject({ kind: "result", body: null });
  });

  it("stops reading a streamed body once it exceeds the ceiling", async () => {
    const oversized = "x".repeat(1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += oversized.length;
        if (sent > ORA_MAX_RESPONSE_BYTES + oversized.length) {
          controller.close();
          return;
        }
        controller.enqueue(new TextEncoder().encode(oversized));
      },
    });
    const { fetchFn } = recorder([new Response(body, { status: 200 })]);
    const { outcome } = await scanOraOrigin(ORIGIN, { fetchFn, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "result", body: null });
  });
});
