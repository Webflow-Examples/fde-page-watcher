import type { Flag, Rec } from "./types";
import type { Tone } from "./vocabulary";

/**
 * A watch flag is not one of the seven work states, so it does not go through
 * `<StatusChip>` — but it is the same kind of label, so it resolves the same
 * tone tokens. This returns the tone NAME; the colour is named once, in
 * globals.css.
 *
 * "Paused" used to be amber. Pausing a page is a deliberate monitoring choice,
 * not something going wrong, so it carries the neutral tone.
 */
export function flagChip(flag: Flag): { label: string; tone: Tone } {
  if (flag === "priority") return { label: "Priority", tone: "information" };
  if (flag === "paused") return { label: "Paused", tone: "neutral" };
  return { label: "Watching", tone: "neutral" };
}

/** Numeric savings (seconds) parsed from a "1.8 s" label, for sorting. */
export function savingsValue(r: Pick<Rec, "savings">): number {
  return parseFloat(r.savings) || 0;
}

/** Coarse cost in hours parsed from "2 days" / "4 hours", for sorting (REQ-048). */
export function costValue(r: Pick<Rec, "estTime">): number {
  const n = parseFloat(r.estTime) || 0;
  return /day/.test(r.estTime) ? n * 24 : n;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a date as "Jul 16" (used for change-marker dates and "done" stamps). */
export function shortDate(d: Date = new Date()): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Human-readable date for prose UI such as "Captured yesterday" or "4 days ago". */
export function naturalDate(value: string, now: Date = new Date()): string {
  const parsed = parseMarkerDate(value, now.getUTCFullYear());
  if (!parsed) return value;

  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const parsedUTC = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  const daysAgo = Math.floor((todayUTC - parsedUTC) / 86_400_000);

  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo > 1 && daysAgo < 7) return `${daysAgo} days ago`;

  const date = `${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}`;
  return parsed.getUTCFullYear() === now.getUTCFullYear()
    ? date
    : `${date}, ${parsed.getUTCFullYear()}`;
}

/** Calendar date for form values and persisted marker dates (always UTC ISO). */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar date in the user's local timezone (for browser-created records). */
export function localISODate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeISODate(value: string, ref = new Date()): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  }
  const parsed = parseMarkerDate(value, ref.getUTCFullYear());
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

/**
 * Parse a date that may be an ISO string or a "Jul 16" display date into a
 * Date (UTC midnight). Display dates carry no year, so `refYear` (default: the
 * current UTC year) supplies one. Returns null if unparseable. Used to place
 * change markers chronologically and to schedule follow-ups from the marker's
 * own date rather than the wall clock (audit High #4).
 */
export function parseMarkerDate(s: string, refYear = new Date().getUTCFullYear()): Date | null {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return null;
  const m = /^([A-Za-z]{3,})\s+(\d{1,2})$/.exec(trimmed);
  if (m) {
    const mon = MONTHS.findIndex((mm) => mm.toLowerCase() === m[1].slice(0, 3).toLowerCase());
    if (mon >= 0) return new Date(Date.UTC(refYear, mon, Number(m[2])));
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}
