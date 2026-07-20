import { describe, it, expect } from "vitest";
import { resolveMarkerIndex, scheduleFollowUps } from "../followups";
import { beforeMarkerNight } from "../collector";
import { parseMarkerDate } from "../ui";
import type { CategoryScore, ChangeMarker, Night, NightScores, StrategyScores } from "../types";

const cat = (m: number): CategoryScore => ({ m, lo: m, hi: m });
const scores = (m: number): NightScores => ({ perf: cat(m), a11y: cat(m), bp: cat(m), seo: cat(m) });
const night = (i: number, iso: string, m: number): Night => ({ i, date: iso.slice(5), iso, scores: { mobile: scores(m), desktop: scores(m) } as StrategyScores });

describe("parseMarkerDate", () => {
  it("parses a 'Jul 16' display date to UTC midnight", () => {
    const d = parseMarkerDate("Jul 16", 2026)!;
    expect(d.toISOString().slice(0, 10)).toBe("2026-07-16");
  });
  it("parses an ISO string", () => {
    const d = parseMarkerDate("2026-06-20T00:00:00.000Z")!;
    expect(d.toISOString().slice(0, 10)).toBe("2026-06-20");
  });
  it("returns null for empty or unparseable input", () => {
    expect(parseMarkerDate("")).toBeNull();
    expect(parseMarkerDate("not a date")).toBeNull();
  });
});

describe("scheduleFollowUps", () => {
  const marker: ChangeMarker = { id: "m1", i: 3, date: "Jun 20", text: "Deployed hero video" };

  it("creates 2/7/30-day follow-ups anchored to the marker date, not now", () => {
    const fus = scheduleFollowUps("pricing", marker);
    expect(fus.map((f) => f.interval)).toEqual(["2d", "7d", "30d"]);
    const base = parseMarkerDate("Jun 20")!.getTime();
    expect(fus[0].dueISO).toBe(new Date(base + 2 * 86400000).toISOString());
    expect(fus[1].dueISO).toBe(new Date(base + 7 * 86400000).toISOString());
    expect(fus[2].dueISO).toBe(new Date(base + 30 * 86400000).toISOString());
  });

  it("references the marker by id and starts unsent with zero attempts", () => {
    const fus = scheduleFollowUps("pricing", marker);
    for (const f of fus) {
      expect(f.markerId).toBe("m1");
      expect(f.id).toBeTruthy();
      expect(f.sent).toBe(false);
      expect(f.attempts).toBe(0);
    }
  });
});

describe("backdated marker comparisons", () => {
  const history = [
    night(0, "2026-07-12T03:00:00.000Z", 70),
    night(1, "2026-07-14T03:00:00.000Z", 72),
    night(2, "2026-07-16T03:00:00.000Z", 74),
  ];

  it("uses the exact night before a marker when it exists", () => {
    expect(beforeMarkerNight(history, "2026-07-17")).toEqual({ night: history[2], substituted: false });
  });

  it("uses the nearest earlier night without skipping an additional record", () => {
    expect(beforeMarkerNight(history, "2026-07-16")).toEqual({ night: history[1], substituted: true });
    expect(resolveMarkerIndex(history, "2026-07-15")).toBe(1);
  });
});
