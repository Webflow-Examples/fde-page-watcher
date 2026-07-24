import { describe, expect, it } from "vitest";
import { DEFAULT_RANGE_DAYS } from "../types";

describe("dashboard range preference", () => {
  it("defaults every fresh app load to seven days", () => {
    expect(DEFAULT_RANGE_DAYS).toBe(7);
  });
});
