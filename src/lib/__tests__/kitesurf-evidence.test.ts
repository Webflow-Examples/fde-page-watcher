import { describe, expect, it } from "vitest";
import {
  safeKitesurfDetail,
  summarizeAriaSnapshot,
  unavailableKitesurfEvidence,
} from "../kitesurfEvidence";

describe("Kitesurf evidence", () => {
  it("summarizes accessibility structure without retaining names", () => {
    const snapshot = `
- document "Example"
  - heading "Welcome" [level=1]
  - link "Pricing"
  - button "Start"
  - textbox "Email"
  - paragraph: Body copy
`;

    expect(summarizeAriaSnapshot(snapshot)).toEqual({
      nodes: 6,
      interactiveNodes: 3,
    });
  });

  it("redacts URLs and bounds unavailable reasons", () => {
    const detail = safeKitesurfDetail(new Error(`failed at https://example.com/private?token=secret ${"x".repeat(300)}`));

    expect(detail).not.toContain("example.com");
    expect(detail).not.toContain("secret");
    expect(detail.length).toBeLessThanOrEqual(200);
    expect(unavailableKitesurfEvidence(new Error("browser unavailable"), "2026-08-10T12:00:00.000Z")).toEqual({
      schemaVersion: 1,
      engine: "kitesurf",
      status: "unavailable",
      capturedAt: "2026-08-10T12:00:00.000Z",
      reason: "browser unavailable",
    });
  });
});
