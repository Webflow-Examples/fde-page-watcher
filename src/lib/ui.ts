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
