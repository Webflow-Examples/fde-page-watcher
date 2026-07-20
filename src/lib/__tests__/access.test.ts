import { describe, expect, it } from "vitest";
import { evaluateAppAccess, evaluateCronAccess } from "../access";

describe("deployment access boundary", () => {
  it("keeps local development open", () => {
    expect(evaluateAppAccess(null, { nodeEnv: "development" }).allowed).toBe(true);
    expect(evaluateCronAccess(null, { nodeEnv: "development", secret: "" }).allowed).toBe(true);
  });

  it("fails closed when production app credentials are missing", () => {
    expect(evaluateAppAccess(null, { nodeEnv: "production", username: "", password: "" })).toMatchObject({ allowed: false, status: 503 });
  });

  it("accepts valid Basic credentials and rejects invalid credentials", () => {
    const config = { nodeEnv: "production", username: "watcher", password: "secret" };
    expect(evaluateAppAccess(`Basic ${btoa("watcher:secret")}`, config).allowed).toBe(true);
    expect(evaluateAppAccess(`Basic ${btoa("watcher:wrong")}`, config)).toMatchObject({ allowed: false, status: 401 });
  });

  it("requires CRON_SECRET outside development", () => {
    expect(evaluateCronAccess(null, { nodeEnv: "production", secret: "" })).toMatchObject({ allowed: false, status: 503 });
    expect(evaluateCronAccess("Bearer cron-secret", { nodeEnv: "production", secret: "cron-secret" }).allowed).toBe(true);
    expect(evaluateCronAccess("Bearer wrong", { nodeEnv: "production", secret: "cron-secret" })).toMatchObject({ allowed: false, status: 401 });
  });
});
