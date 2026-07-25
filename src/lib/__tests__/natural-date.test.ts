import { describe, expect, it } from "vitest";
import { naturalDate } from "../ui";

describe("naturalDate", () => {
  const now = new Date("2026-07-24T23:30:00.000Z");

  it("uses relative language for recent captures", () => {
    expect(naturalDate("2026-07-24T05:00:00.000Z", now)).toBe("today");
    expect(naturalDate("2026-07-23T23:20:00.000Z", now)).toBe("yesterday");
    expect(naturalDate("2026-07-20T23:20:53.268Z", now)).toBe("4 days ago");
  });

  it("uses a natural calendar label for older captures", () => {
    expect(naturalDate("Jun 17", now)).toBe("Jun 17");
    expect(naturalDate("2025-12-08T12:00:00.000Z", now)).toBe("Dec 8, 2025");
  });

  it("preserves an unparseable display value", () => {
    expect(naturalDate("unknown", now)).toBe("unknown");
  });
});
