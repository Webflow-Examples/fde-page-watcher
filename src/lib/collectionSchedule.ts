import type { CollectionSchedule, WatchPage } from "./types";
import { isPageActivelyMonitored } from "./watchCapacity";

export const DEFAULT_COLLECTION_TIME = "00:00";
export const DEFAULT_COLLECTION_TIME_ZONE = "UTC";
export const PAGE_COLLECTION_SPACING_MINUTES = 15;
const COLLECTION_WINDOW_SLOTS = 20;

export function collectionScheduleIsValid(value: Partial<CollectionSchedule>): value is CollectionSchedule {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.localTime ?? "")) return false;
  if (typeof value.overridden !== "boolean" || !value.timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeCollectionSchedule(
  value?: Partial<CollectionSchedule>,
): CollectionSchedule {
  return collectionScheduleIsValid(value ?? {})
    ? value as CollectionSchedule
    : {
        timeZone: DEFAULT_COLLECTION_TIME_ZONE,
        localTime: DEFAULT_COLLECTION_TIME,
        overridden: false,
      };
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

export interface CollectionLocalDateTime {
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
}

/** Calendar date and wall-clock time in the project's saved collection timezone. */
export function collectionLocalDateTime(
  value: string | Date,
  timeZone: string,
): CollectionLocalDateTime | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = localParts(date, timeZone);
    return {
      dateKey: dateKey(parts),
      dateLabel: new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
      }).format(date),
      timeLabel: new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }).format(date),
    };
  } catch {
    return null;
  }
}

function dateKey(parts: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return dateKey({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** Resolve a local wall-clock time into UTC, including DST offset changes. */
export function collectionInstant(
  schedule: CollectionSchedule,
  localDate: string,
  offsetMinutes = 0,
): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = schedule.localTime.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute + offsetMinutes);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localParts(new Date(guess), schedule.timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const correction = desired - observedAsUtc;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function collectionOffsets(pages: WatchPage[]): Map<string, number> {
  return new Map(pages.filter(isPageActivelyMonitored).map((page) => [
    page.id,
    Number.isInteger(page.collectionOffsetMinutes)
      ? page.collectionOffsetMinutes!
      : (stableHash(page.id) % COLLECTION_WINDOW_SLOTS) * PAGE_COLLECTION_SPACING_MINUTES,
  ]));
}

/** Persist stable, collision-free slots so later page additions cannot move existing pages. */
export function ensureCollectionOffsets(pages: WatchPage[]): void {
  const active = pages.filter(isPageActivelyMonitored);
  const used = new Set<number>();
  for (const page of active) {
    if (!Number.isInteger(page.collectionOffsetMinutes)) continue;
    if (used.has(page.collectionOffsetMinutes!)) delete page.collectionOffsetMinutes;
    else used.add(page.collectionOffsetMinutes!);
  }
  const missing = pages
    .filter((page) =>
      isPageActivelyMonitored(page)
      && !Number.isInteger(page.collectionOffsetMinutes))
    .sort((left, right) => stableHash(left.id) - stableHash(right.id) || left.id.localeCompare(right.id));
  for (const page of missing) {
    const preferred = stableHash(page.id) % COLLECTION_WINDOW_SLOTS;
    let slot = preferred;
    for (let probe = 0; probe < COLLECTION_WINDOW_SLOTS; probe += 1) {
      const offset = slot * PAGE_COLLECTION_SPACING_MINUTES;
      if (!used.has(offset)) {
        page.collectionOffsetMinutes = offset;
        used.add(offset);
        break;
      }
      slot = (slot + 1) % COLLECTION_WINDOW_SLOTS;
    }
    // Capacity currently keeps active pages below the slot count. This fallback
    // remains deterministic if that product limit grows before this window does.
    if (!Number.isInteger(page.collectionOffsetMinutes)) {
      page.collectionOffsetMinutes = pages.indexOf(page) * PAGE_COLLECTION_SPACING_MINUTES;
    }
  }
}

export interface PageScheduleDue {
  due: boolean;
  scheduledAt: string;
  nextScheduledAt: string;
  cohortId: string;
}

export function pageScheduleDue(
  page: WatchPage,
  pages: WatchPage[],
  inputSchedule: CollectionSchedule | undefined,
  now = new Date(),
): PageScheduleDue {
  const schedule = normalizeCollectionSchedule(inputSchedule);
  const today = dateKey(localParts(now, schedule.timeZone));
  const offset = collectionOffsets(pages).get(page.id) ?? 0;
  let cohortDate = today;
  let scheduled = collectionInstant(schedule, cohortDate, offset);
  if (scheduled.getTime() > now.getTime()) {
    cohortDate = shiftDateKey(today, -1);
    scheduled = collectionInstant(schedule, cohortDate, offset);
  }
  const next = collectionInstant(schedule, shiftDateKey(cohortDate, 1), offset);
  const lastScheduled = page.lastScheduledAt ? Date.parse(page.lastScheduledAt) : Number.NaN;
  return {
    due: !Number.isFinite(lastScheduled) || lastScheduled < scheduled.getTime(),
    scheduledAt: scheduled.toISOString(),
    nextScheduledAt: next.toISOString(),
    cohortId: `nightly:${cohortDate}`,
  };
}
