import { describe, it, expect } from "vitest";
import { scheduleFollowUps } from "../followups";
import { parseMarkerDate } from "../ui";
import type { ChangeMarker } from "../types";

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
      expect(f.sent).toBe(false);
      expect(f.attempts).toBe(0);
    }
  });
});
