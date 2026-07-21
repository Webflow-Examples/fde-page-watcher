import { describe, expect, it } from "vitest";
import { evaluateCronAccess } from "../access";

describe("deployment access boundary", () => {
  it("keeps local development open", () => {
    expect(evaluateCronAccess(null, { nodeEnv: "development", secret: "" }).allowed).toBe(true);
  });

  it("requires CRON_SECRET outside development", () => {
    expect(evaluateCronAccess(null, { nodeEnv: "production", secret: "" })).toMatchObject({ allowed: false, status: 503 });
    expect(evaluateCronAccess("Bearer cron-secret", { nodeEnv: "production", secret: "cron-secret" }).allowed).toBe(true);
    expect(evaluateCronAccess("Bearer wrong", { nodeEnv: "production", secret: "cron-secret" })).toMatchObject({ allowed: false, status: 401 });
  });
});
