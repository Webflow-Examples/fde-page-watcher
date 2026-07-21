import { describe, expect, it } from "vitest";
import { normalizeBasePath, withBasePath } from "../paths";

describe("deployment mount paths", () => {
  it("normalizes paths and full deployment URLs", () => {
    expect(normalizeBasePath("/page-watch/")).toBe("/page-watch");
    expect(normalizeBasePath("https://example.com/tools/page-watch/")).toBe("/tools/page-watch");
    expect(normalizeBasePath("/")).toBe("");
  });

  it("prefixes client routes and API calls once", () => {
    expect(withBasePath("/page-watch", "/api/state")).toBe("/page-watch/api/state");
    expect(withBasePath("", "/dashboard")).toBe("/dashboard");
  });
});
