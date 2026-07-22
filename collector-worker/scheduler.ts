export const NIGHTLY_CRON = "0 3 * * *";
export const ONE_TIME_TEST_CRON = "0 20 22 7 *";
export const ONE_TIME_TEST_AT = "2026-07-22T20:00";
export const SCHEDULER_STATUS_KEY = "scheduler/latest.json";

export interface SchedulerEnvironment {
  PAGE_WATCHER_NIGHTLY_URL: string;
  CRON_SECRET: string;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
}

export interface ScheduleControllerLike {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry(): void;
}

export interface NightlyDispatchResponse {
  ok: true;
  queued: number;
  coalesced: number;
  failed: unknown[];
}

export type ScheduledDispatchResult =
  | { status: "skipped"; reason: string; cron: string; scheduledAt: string }
  | { status: "succeeded"; cron: string; scheduledAt: string; scheduleId: string; response: NightlyDispatchResponse };

class ScheduledDispatchError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = "ScheduledDispatchError";
  }
}

function isOneTimeTest(controller: ScheduleControllerLike): boolean {
  return controller.cron === ONE_TIME_TEST_CRON
    && new Date(controller.scheduledTime).toISOString().slice(0, 16) === ONE_TIME_TEST_AT;
}

function scheduleId(controller: ScheduleControllerLike): string {
  return `cron-${controller.scheduledTime}`;
}

async function readBoundedText(response: Response, limit = 4_096): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < limit) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length >= limit) {
        await reader.cancel();
        break;
      }
    }
    text += decoder.decode();
    return text.slice(0, limit);
  } finally {
    reader.releaseLock();
  }
}

function parseNightlyResponse(text: string): NightlyDispatchResponse | null {
  try {
    const value = JSON.parse(text) as Partial<NightlyDispatchResponse>;
    return value.ok === true
      && Number.isFinite(value.queued)
      && Number.isFinite(value.coalesced)
      && Array.isArray(value.failed)
      ? value as NightlyDispatchResponse
      : null;
  } catch {
    return null;
  }
}

export async function dispatchScheduledNightly(
  controller: ScheduleControllerLike,
  env: SchedulerEnvironment,
  fetchFn: typeof fetch = fetch,
): Promise<ScheduledDispatchResult> {
  const scheduledAt = new Date(controller.scheduledTime).toISOString();
  if (controller.cron === ONE_TIME_TEST_CRON && !isOneTimeTest(controller)) {
    controller.noRetry();
    return { status: "skipped", reason: "one-time test window has passed", cron: controller.cron, scheduledAt };
  }
  if (controller.cron !== NIGHTLY_CRON && controller.cron !== ONE_TIME_TEST_CRON) {
    controller.noRetry();
    return { status: "skipped", reason: "unrecognized cron expression", cron: controller.cron, scheduledAt };
  }

  let nightlyUrl: URL;
  try {
    nightlyUrl = new URL(env.PAGE_WATCHER_NIGHTLY_URL);
  } catch {
    controller.noRetry();
    throw new ScheduledDispatchError("PAGE_WATCHER_NIGHTLY_URL is invalid");
  }
  if (nightlyUrl.protocol !== "https:") {
    controller.noRetry();
    throw new ScheduledDispatchError("PAGE_WATCHER_NIGHTLY_URL must use HTTPS");
  }

  const id = scheduleId(controller);
  let response: Response;
  try {
    response = await fetchFn(nightlyUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        "cf-access-client-id": env.CF_ACCESS_CLIENT_ID,
        "cf-access-client-secret": env.CF_ACCESS_CLIENT_SECRET,
        "x-page-watcher-schedule-id": id,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ScheduledDispatchError(`Nightly dispatcher request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await readBoundedText(response);
  const body = parseNightlyResponse(text);
  if (!response.ok || !body) {
    if (response.status >= 300 && response.status < 500) controller.noRetry();
    const detail = body ? JSON.stringify(body) : text || "empty response";
    throw new ScheduledDispatchError(`Nightly dispatcher returned ${response.status}: ${detail}`, response.status);
  }

  return { status: "succeeded", cron: controller.cron, scheduledAt, scheduleId: id, response: body };
}

export function schedulerError(error: unknown): { message: string; httpStatus?: number } {
  return error instanceof ScheduledDispatchError
    ? { message: error.message, httpStatus: error.httpStatus }
    : { message: error instanceof Error ? error.message : String(error) };
}
