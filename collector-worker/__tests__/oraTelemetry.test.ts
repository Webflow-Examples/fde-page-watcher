import { describe, expect, it, vi } from "vitest";
import {
  emptyOraRunCounters,
  oraCacheHitRatio,
  oraOperationLogEvent,
  oraRunLogEvent,
  safeOraHost,
  type OraOperation,
} from "../oraTelemetry";

const OPERATIONS: OraOperation[] = [
  "cached-read",
  "full-scan",
  "poll",
  "selective-checks",
  "persist",
];

function parse(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

describe("safe hostname", () => {
  it("keeps only the hostname", () => {
    expect(safeOraHost("https://example.com/pricing?key=secret#x")).toBe("example.com");
    expect(safeOraHost("http://sub.example.com:8080/a")).toBe("sub.example.com");
    expect(safeOraHost("not a url")).toBe("unknown");
    expect(safeOraHost("")).toBe("unknown");
  });
});

describe("provider operation events", () => {
  it("emits one line per documented operation", () => {
    for (const operation of OPERATIONS) {
      const event = parse(oraOperationLogEvent({
        operation,
        tenant: "brand-studio:live",
        host: "example.com",
        status: "ok",
      }));
      expect(event.operation).toBe(operation);
      expect(event.provider).toBe("ora");
      expect(event.tenant).toBe("brand-studio:live");
      expect(event.host).toBe("example.com");
    }
  });

  it("carries the operational fields the plan asks for", () => {
    const event = parse(oraOperationLogEvent({
      operation: "full-scan",
      tenant: "brand-studio:live",
      host: "example.com",
      status: "rate-limited",
      httpStatus: 429,
      servedFromCache: false,
      resultAgeSeconds: 1_800,
      checkCount: 124,
      durationMs: 1234.6,
      retryAfterSeconds: 14_400,
      providerErrorCode: "RATE_LIMITED",
    }));
    expect(event).toMatchObject({
      httpStatus: 429,
      servedFromCache: false,
      resultAgeSeconds: 1_800,
      checkCount: 124,
      durationMs: 1235,
      retryAfterSeconds: 14_400,
      providerErrorCode: "RATE_LIMITED",
    });
  });

  it("omits fields that were not observed rather than writing zeros", () => {
    const event = parse(oraOperationLogEvent({
      operation: "persist",
      tenant: "t",
      host: "example.com",
      status: "available",
    }));
    for (const field of ["httpStatus", "durationMs", "checkCount", "retryAfterSeconds", "providerErrorCode", "servedFromCache", "resultAgeSeconds"]) {
      expect(event).not.toHaveProperty(field);
    }
  });

  it("never writes a URL, query string, credential, or header", () => {
    // Provider prose routinely embeds the scanned URL; it must be stripped.
    const line = oraOperationLogEvent({
      operation: "full-scan",
      tenant: "brand-studio:live",
      host: "https://user:pass@example.com/private?token=abc123",
      status: "failed https://example.com/private?token=abc123",
      providerErrorCode: "see https://ora.ai/score/example.com?k=secret",
    });
    expect(line).not.toContain("token=abc123");
    expect(line).not.toContain("user:pass");
    expect(line).not.toMatch(/https?:\/\//);
    expect(line.toLowerCase()).not.toContain("authorization");
    expect(line.toLowerCase()).not.toContain("bearer");
    // The hostname still survives, so the line stays useful.
    expect(parse(line).host).toBe("example.com");
  });

  it("bounds provider-controlled text", () => {
    const event = parse(oraOperationLogEvent({
      operation: "poll",
      tenant: "t",
      host: "example.com",
      status: "s".repeat(500),
      providerErrorCode: "c".repeat(500),
    }));
    expect(String(event.status)).toHaveLength(60);
    expect(String(event.providerErrorCode)).toHaveLength(80);
  });
});

describe("run counters", () => {
  it("starts at zero on every field", () => {
    expect(Object.values(emptyOraRunCounters()).every((value) => value === 0)).toBe(true);
  });

  it("reports no cache hit ratio when nothing was read", () => {
    // Null, not zero: an idle run is not a total cache miss.
    expect(oraCacheHitRatio(emptyOraRunCounters())).toBeNull();
  });

  it("computes the cache hit ratio from reads that avoided a scan", () => {
    expect(oraCacheHitRatio({ ...emptyOraRunCounters(), cachedReads: 4, cacheHits: 3 })).toBe(0.75);
    expect(oraCacheHitRatio({ ...emptyOraRunCounters(), cachedReads: 3, cacheHits: 1 })).toBe(0.33);
    expect(oraCacheHitRatio({ ...emptyOraRunCounters(), cachedReads: 2, cacheHits: 2 })).toBe(1);
  });

  it("summarizes a run with counts only", () => {
    const event = parse(oraRunLogEvent("brand-studio:live", {
      ...emptyOraRunCounters(),
      cachedReads: 3,
      cacheHits: 2,
      scansAttempted: 1,
      scansSucceeded: 1,
      verificationsResolved: 1,
      contractFailures: 1,
    }, { operation: "refresh", origins: 3 }));
    expect(event).toMatchObject({
      provider: "ora",
      operation: "refresh",
      origins: 3,
      cachedReads: 3,
      cacheHits: 2,
      scansAttempted: 1,
      scansSucceeded: 1,
      verificationsResolved: 1,
      contractFailures: 1,
      cacheHitRatio: 0.67,
    });
  });

  it("distinguishes the three verification outcomes", () => {
    const event = parse(oraRunLogEvent("t", {
      ...emptyOraRunCounters(),
      verificationsResolved: 2,
      verificationsReturned: 1,
      verificationsUnconfirmed: 3,
    }, { operation: "verify" }));
    expect(event.verificationsResolved).toBe(2);
    expect(event.verificationsReturned).toBe(1);
    // A provider that could not answer is counted apart from a real failure.
    expect(event.verificationsUnconfirmed).toBe(3);
  });

  it("never writes a URL or credential", () => {
    const line = oraRunLogEvent("https://tenant?token=abc", emptyOraRunCounters());
    expect(line).not.toContain("token=abc");
    expect(line).not.toMatch(/https?:\/\//);
  });
});

describe("operation coverage", () => {
  it("logs every provider request the client makes", async () => {
    // The client emits an operation for each request kind, so no provider call
    // can happen without a corresponding log line.
    const { getCachedOraAudit, scanOraOrigin, runOraChecks } = await import("../oraClient");
    const seen: string[] = [];
    const onOperation = (operation: { operation: string }) => seen.push(operation.operation);
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/scan/checks")) {
        return Response.json({ contractVersion: "1.21.0", results: [{ id: "a", status: "pass" }] });
      }
      return Response.json({ contractVersion: "1.21.0", analysisStatus: "complete" });
    }) as unknown as typeof fetch;

    await getCachedOraAudit("https://example.com", { fetchFn, onOperation });
    await scanOraOrigin("https://example.com", { fetchFn, onOperation, sleep: async () => undefined });
    await runOraChecks("https://example.com", ["a"], { fetchFn, onOperation });
    expect(seen).toEqual(["cached-read", "full-scan", "selective-checks"]);
  });
});
