import { describe, expect, it } from "vitest";
import { defaultNewPageFlag, flagCapacityError, MAX_ACTIVE_PAGES, MAX_PRIORITY_PAGES, normalizeWatchCapacity, watchCapacity } from "../watchCapacity";
import type { Flag } from "../types";

const page = (id: string, flag: Flag) => ({ id, flag });

describe("watch capacity", () => {
  it("allows at most three Priority pages without treating active-to-active changes as a new slot", () => {
    const pages = [
      page("p1", "priority"),
      page("p2", "priority"),
      page("p3", "priority"),
      page("watching", "watching"),
      page("paused", "paused"),
    ];

    expect(flagCapacityError(pages, "watching", "priority")).toContain(`Only ${MAX_PRIORITY_PAGES} pages`);
    expect(flagCapacityError(pages, "p1", "priority")).toBeNull();
    expect(flagCapacityError(pages, "paused", "watching")).toBeNull();
  });

  it("allows only ten active pages while leaving total watchlist size unlimited", () => {
    const pages = [
      ...Array.from({ length: MAX_ACTIVE_PAGES }, (_, index) => page(`active-${index}`, index < 3 ? "priority" : "watching")),
      page("paused-1", "paused"),
      page("paused-2", "paused"),
    ];

    expect(watchCapacity(pages)).toEqual({ active: 10, priority: 3, paused: 2, total: 12 });
    expect(flagCapacityError(pages, "paused-1", "watching")).toContain(`Only ${MAX_ACTIVE_PAGES} pages`);
    expect(flagCapacityError(pages, "active-9", "paused")).toBeNull();
  });

  it("defaults a new page to Paused only after all active slots are used", () => {
    const pages = Array.from({ length: MAX_ACTIVE_PAGES }, (_, index) =>
      page(`active-${index}`, "watching"),
    );

    expect(defaultNewPageFlag(pages.slice(0, -1))).toBe("watching");
    expect(defaultNewPageFlag(pages)).toBe("paused");
    expect(defaultNewPageFlag([...pages, page("already-paused", "paused")])).toBe("paused");
  });

  it("normalizes legacy over-limit state deterministically", () => {
    const pages = [
      ...Array.from({ length: 4 }, (_, index) => page(`priority-${index}`, "priority")),
      ...Array.from({ length: 8 }, (_, index) => page(`watching-${index}`, "watching")),
    ];

    expect(normalizeWatchCapacity(pages)).toBe(true);

    expect(watchCapacity(pages)).toEqual({ active: 10, priority: 3, paused: 2, total: 12 });
    expect(pages[3].flag).toBe("watching");
    expect(pages.slice(-2).every((item) => item.flag === "paused")).toBe(true);
  });
});
