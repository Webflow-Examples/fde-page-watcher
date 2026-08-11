import { describe, expect, it } from "vitest";
import { parseProjectConfiguration } from "../projects";

describe("project configuration", () => {
  it("parses an ordered project allowlist", () => {
    expect(parseProjectConfiguration(JSON.stringify([
      { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live" },
      { id: "marketing", name: "Marketing", tenant: "marketing:live" },
    ]))).toEqual([
      { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live" },
      { id: "marketing", name: "Marketing", tenant: "marketing:live" },
    ]);
  });

  it("rejects duplicate public ids", () => {
    expect(() => parseProjectConfiguration(JSON.stringify([
      { id: "same", name: "One", tenant: "one" },
      { id: "same", name: "Two", tenant: "two" },
    ]))).toThrow("duplicate id same");
  });

  it("rejects unsafe tenant identifiers", () => {
    expect(() => parseProjectConfiguration(JSON.stringify([
      { id: "unsafe", name: "Unsafe", tenant: "../../other" },
    ]))).toThrow("tenant is invalid");
  });
});
