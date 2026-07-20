import type { Flag, Rec, TaskStatus } from "./types";

/** Shared palette (mirrors globals.css vars) for inline styles ported from the design. */
export const C = {
  bg: "#0B0B0C",
  bgElev: "#0E0E10",
  panel: "#131315",
  panel2: "#161619",
  border: "#1E1E22",
  border2: "#26262A",
  rowBorder: "#17171A",
  text: "#F4F4F5",
  dim: "#C4C4C8",
  muted: "#8A8A90",
  faint: "#6C6C72",
  faint2: "#9A9AA0",
  accent: "#146EF5",
  accentBright: "#3B89FF",
  accentSoft: "#5EA0FF",
  violet: "#8A5CF6",
  violetSoft: "#B79CFF",
  green: "#35D07F",
  amber: "#FF9A3D",
  red: "#FF5C6C",
  redSoft: "#FF9A9F",
} as const;

export function flagChip(flag: Flag): { label: string; fg: string; bg: string } {
  return flag === "priority"
    ? { label: "Priority", fg: C.accentSoft, bg: "rgba(59,137,255,0.16)" }
    : { label: "Watching", fg: C.faint2, bg: "rgba(255,255,255,0.06)" };
}

export function taskLabel(ts: TaskStatus): string {
  return ts === "todo" ? "To do" : ts === "in-progress" ? "In progress" : "Done";
}

export function taskAccent(ts: TaskStatus): string {
  return ts === "todo" ? C.muted : ts === "in-progress" ? C.accentSoft : C.green;
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

/** Calendar date for form values and persisted marker dates (always UTC ISO). */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
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
