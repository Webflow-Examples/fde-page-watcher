import { describe, expect, it } from "vitest";
import { createMemoryIntegrationStore } from "../store";
import {
  PAGE_WATCH_SIGNATURE_HEADER,
  decisionEvent,
  deliverEvent,
  emitEvent,
  transitionEvent,
} from "../events";
import { signHmac } from "../crypto";
import type { CaseDecisionRecord, CaseTransitionRecord } from "../../types";

const SECRET = "webhook-secret-that-is-at-least-32-characters";

const decision: CaseDecisionRecord = {
  decision: "accept",
  remediationKey: "steps:direct:[\"fix\"]",
  at: "2026-11-01T10:00:00.000Z",
  by: { kind: "person", userId: "rae@webflow.com" },
};

const transition: CaseTransitionRecord = {
  caseKey: "home:unused-javascript",
  action: "reopen",
  at: "2026-11-02T10:00:00.000Z",
  by: { kind: "person", userId: "rae@webflow.com" },
};

describe("signed outbound events", () => {
  it("names an event deterministically from the fact it describes", () => {
    expect(decisionEvent("brand-studio", decision).id).toBe(decisionEvent("brand-studio", decision).id);
    expect(decisionEvent("brand-studio", decision).id).not.toBe(decisionEvent("other", decision).id);
    expect(transitionEvent("brand-studio", transition).event).toBe("page_watch.case_transitioned");
  });

  it("signs the exact body with HMAC-SHA256", async () => {
    let seen: { body: string; signature: string | null; event: string | null; delivery: string | null } | null = null;
    const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      seen = {
        body: String(init.body),
        signature: headers.get(PAGE_WATCH_SIGNATURE_HEADER),
        event: headers.get("x-pagewatch-event"),
        delivery: headers.get("x-pagewatch-delivery"),
      };
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const event = decisionEvent("brand-studio", decision);
    const result = await deliverEvent({ url: "https://hooks.example.test/pw", secret: SECRET, event, fetchImpl });
    expect(result).toEqual({ delivered: true, status: 200 });
    expect(seen).not.toBeNull();
    const captured = seen as unknown as { body: string; signature: string; event: string; delivery: string };
    expect(captured.signature).toBe(`sha256=${signHmac(captured.body, SECRET)}`);
    expect(captured.event).toBe("page_watch.case_decided");
    expect(captured.delivery).toBe(event.id);
  });

  it("retries a 429 and a 5xx with backoff", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response("busy", { status: attempts < 3 ? (attempts === 1 ? 429 : 503) : 200 });
    }) as typeof fetch;
    const result = await deliverEvent({
      url: "https://hooks.example.test/pw",
      secret: SECRET,
      event: decisionEvent("brand-studio", decision),
      fetchImpl,
      sleep: async (ms) => { delays.push(ms); },
    });
    expect(result.delivered).toBe(true);
    expect(attempts).toBe(3);
    expect(delays).toEqual([200, 400]);
  });

  it("reports a failed delivery without throwing", async () => {
    const fetchImpl = (async () => new Response("no", { status: 403 })) as typeof fetch;
    const result = await deliverEvent({
      url: "https://hooks.example.test/pw",
      secret: SECRET,
      event: decisionEvent("brand-studio", decision),
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("403");
  });

  it("sends one copy of an event, even if the dispatch runs twice", async () => {
    const store = createMemoryIntegrationStore("brand-studio");
    let deliveries = 0;
    const fetchImpl = (async () => {
      deliveries += 1;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const event = transitionEvent("brand-studio", transition);
    const input = {
      store,
      projectId: "brand-studio",
      event,
      webhookUrl: "https://hooks.example.test/pw",
      secret: SECRET,
      fetchImpl,
    };
    expect((await emitEvent(input)).delivered).toBe(true);
    expect(await emitEvent(input)).toEqual({ delivered: false, skipped: "already-sent" });
    expect(deliveries).toBe(1);
  });

  it("does nothing when no webhook is configured", async () => {
    const store = createMemoryIntegrationStore("brand-studio");
    const result = await emitEvent({
      store,
      projectId: "brand-studio",
      event: decisionEvent("brand-studio", decision),
    });
    expect(result).toEqual({ delivered: false, skipped: "not-configured" });
    expect(await store.listEvents()).toHaveLength(0);
  });
});
