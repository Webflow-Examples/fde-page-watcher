import { describe, expect, it, vi } from "vitest";
import {
  dispatchScheduledNightly,
  NIGHTLY_CRON,
  ONE_TIME_TEST_CRON,
  type ScheduleControllerLike,
  type SchedulerEnvironment,
} from "../../../collector-worker/scheduler";

const env: SchedulerEnvironment = {
  PAGE_WATCHER_NIGHTLY_URL: "https://page-watcher.wf.app/api/cron/nightly",
  CRON_SECRET: "cron-secret",
  CF_ACCESS_CLIENT_ID: "service-id",
  CF_ACCESS_CLIENT_SECRET: "service-secret",
};

function controller(cron: string, scheduledAt: string) {
  return {
    cron,
    scheduledTime: Date.parse(scheduledAt),
    noRetry: vi.fn(),
  } satisfies ScheduleControllerLike;
}

describe("collector nightly scheduler", () => {
  it("dispatches the one-time noon test with both Access and cron authentication", async () => {
    const event = controller(ONE_TIME_TEST_CRON, "2026-07-22T17:00:00.000Z");
    const fetchFn = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(String(input)).toBe(env.PAGE_WATCHER_NIGHTLY_URL);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("manual");
      expect(headers.get("authorization")).toBe("Bearer cron-secret");
      expect(headers.get("cf-access-client-id")).toBe("service-id");
      expect(headers.get("cf-access-client-secret")).toBe("service-secret");
      expect(headers.get("x-page-watcher-schedule-id")).toBe(`cron-${event.scheduledTime}`);
      return Response.json({ ok: true, queued: 11, coalesced: 0, failed: [] }, { status: 202 });
    }) as typeof fetch;

    await expect(dispatchScheduledNightly(event, env, fetchFn)).resolves.toMatchObject({
      status: "succeeded",
      scheduleId: `cron-${event.scheduledTime}`,
      response: { queued: 11 },
    });
    expect(event.noRetry).not.toHaveBeenCalled();
  });

  it("dispatches the recurring 03:00 UTC nightly schedule", async () => {
    const event = controller(NIGHTLY_CRON, "2026-07-23T03:00:00.000Z");
    const fetchFn = vi.fn(async () => Response.json({ ok: true, queued: 11, coalesced: 0, failed: [] }, { status: 202 })) as typeof fetch;

    await expect(dispatchScheduledNightly(event, env, fetchFn)).resolves.toMatchObject({ status: "succeeded", cron: NIGHTLY_CRON });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("permanently skips the one-time test trigger outside its intended date", async () => {
    const event = controller(ONE_TIME_TEST_CRON, "2027-07-22T17:00:00.000Z");
    const fetchFn = vi.fn() as unknown as typeof fetch;

    await expect(dispatchScheduledNightly(event, env, fetchFn)).resolves.toMatchObject({ status: "skipped" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(event.noRetry).toHaveBeenCalledOnce();
  });

  it("does not retry Access or other terminal HTTP failures", async () => {
    const event = controller(NIGHTLY_CRON, "2026-07-23T03:00:00.000Z");
    const fetchFn = vi.fn(async () => new Response("Access denied", { status: 401 })) as typeof fetch;

    await expect(dispatchScheduledNightly(event, env, fetchFn)).rejects.toThrow("returned 401");
    expect(event.noRetry).toHaveBeenCalledOnce();
  });
});
