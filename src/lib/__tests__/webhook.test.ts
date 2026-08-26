import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alertWebhookUrlIsValid,
  buildDailyDigestWebhookPayload,
  postWebhook,
} from "../webhook";
import { buildDigest, type Digest } from "../digest";
import { renderDigestMessage } from "../digest-email";
import { markFixed, type IssueCase } from "../issue-case";
import type { Caller } from "../caller";
import { recordCheckpointReading } from "../checkpoint-evaluation";
import { normalizePerformanceThresholds } from "../performanceThresholds";
import { pendingPage } from "../mutations";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AT = "2026-08-04T06:00:00.000Z";

/**
 * Whoever marked the fix. The payload is the digest message and the digest is
 * about cases, so this only ever satisfies the transition guard.
 */
const PERSON: Caller = { kind: "person", userId: "rae@webflow.com" };

function caseOf(overrides: Partial<IssueCase> = {}): IssueCase {
  return {
    id: "PW-1",
    cause: "c",
    state: "in_progress",
    title: "Unused JavaScript",
    diagnosis: "The homepage ships a bundle nothing on it uses.",
    detectedAt: AT,
    confirmedRuns: 2,
    scope: "pages",
    pageIds: ["home"],
    strategies: ["mobile"],
    impactMs: 1800,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: ["Remove it."], actionability: "direct" },
    successCriteria: "Gone.",
    checkpoints: [],
    evidence: [],
    history: [],
    ...overrides,
  };
}

function digestOf(cases: IssueCase[] = []): Digest {
  return buildDigest({
    site: "example.com",
    date: "2026-08-04",
    cadence: "daily",
    cases,
    pages: [pendingPage("home", "Homepage", "https://example.com", "watching")],
    thresholds: normalizePerformanceThresholds({}),
    appUrl: "https://watch.example.com",
  });
}

describe("alert webhook", () => {
  it("accepts credential-free HTTPS URLs only", () => {
    expect(alertWebhookUrlIsValid("https://hooks.example.com/page-watch?token=secret")).toBe(true);
    expect(alertWebhookUrlIsValid("http://hooks.example.com/page-watch")).toBe(false);
    expect(alertWebhookUrlIsValid("https://user:pass@hooks.example.com/page-watch")).toBe(false);
    expect(alertWebhookUrlIsValid("not a URL")).toBe(false);
  });

  it("carries the one digest rather than a second summary of the same night", () => {
    /**
     * Before S7 this built its own summary from a list of regressing pages, so
     * the product had two descriptions of one run that nothing kept in step —
     * and the webhook's was written in the page-status vocabulary F2 retired.
     * The assertion is that the payload IS the message: same subject, same
     * sections, same sentences.
     */
    const digest = digestOf([
      recordCheckpointReading(markFixed(caseOf(), { by: PERSON, at: AT }), {
        interval: "7d",
        outcome: "disagreed",
        at: AT,
      }).issue,
    ]);
    const payload = buildDailyDigestWebhookPayload(digest, "nightly:2026-08-04");

    expect(payload).toMatchObject({
      event: "page_watch.daily_digest",
      version: 2,
      id: "nightly:2026-08-04",
      date: "2026-08-04",
      site: "example.com",
      subject: digest.subject,
    });
    expect(payload.text).toBe(renderDigestMessage(digest).text);
    expect(payload.sections.map((section) => section.kind)).toEqual(
      digest.sections.map((section) => section.kind),
    );
    // A machine reader gets the case id, so it can address the case without
    // parsing the link.
    expect(payload.sections[0].lines[0]).toMatchObject({ caseId: "PW-1" });
  });

  it("still posts on a quiet night, and says so in the subject", () => {
    const payload = buildDailyDigestWebhookPayload(digestOf(), "nightly:2026-08-04");
    expect(payload.subject).toBe("example.com · nothing needs you");
    expect(payload.sections).toEqual([]);
  });

  it("does not attempt delivery without a configured URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const delivery = await postWebhook(undefined, buildDailyDigestWebhookPayload(digestOf(), "nightly:1970-01-01"));
    expect(delivery).toEqual({ sent: false, error: "Alert webhook URL is not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts JSON and accepts only a 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = buildDailyDigestWebhookPayload(digestOf(), "nightly:1970-01-01");
    const delivery = await postWebhook("https://hooks.example.com/page-watch", payload);
    expect(delivery).toEqual({ sent: true, status: 202 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.com/page-watch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
        headers: expect.objectContaining({ "idempotency-key": "nightly:1970-01-01" }),
      }),
    );
  });

  it("retains Retry-After without reading an unbounded error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ignored", {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Retry-After": "120" },
    })));
    const delivery = await postWebhook(
      "https://hooks.example.com/page-watch",
      buildDailyDigestWebhookPayload(digestOf(), "nightly:1970-01-01"),
    );
    expect(delivery).toMatchObject({
      sent: false,
      status: 429,
      error: "429 Too Many Requests",
      retryAfterSeconds: 120,
    });
  });
});
