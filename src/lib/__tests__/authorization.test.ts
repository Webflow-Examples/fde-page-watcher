import { describe, expect, it } from "vitest";
import { accessFromRegistryState } from "../authorization";
import { buildInitialState } from "../seed";

describe("role resolution", () => {
  it("gives immutable bootstrap admins visibility across all projects", () => {
    const access = accessFromRegistryState({ email: "Matthew@Webflow.com", source: "development" }, buildInitialState("live"));
    expect(access).toEqual({ email: "matthew@webflow.com", isAppAdmin: true, projectRoles: {} });
  });

  it("resolves only explicit project memberships for customer emails", () => {
    const state = buildInitialState("live");
    state.projectMemberships = [
      { projectId: "brand-studio", email: "customer@example.com", role: "project_viewer", invitedBy: "matthew@webflow.com", invitedAt: "2026-08-11T00:00:00.000Z" },
      { projectId: "marketing", email: "customer@example.com", role: "project_admin", invitedBy: "matthew@webflow.com", invitedAt: "2026-08-11T00:00:00.000Z" },
      { projectId: "private", email: "someone@example.com", role: "project_admin", invitedBy: "matthew@webflow.com", invitedAt: "2026-08-11T00:00:00.000Z" },
    ];
    expect(accessFromRegistryState({ email: "customer@example.com", source: "development" }, state)).toEqual({
      email: "customer@example.com",
      isAppAdmin: false,
      projectRoles: { "brand-studio": "project_viewer", marketing: "project_admin" },
    });
  });

  it("recognizes stored app admins without granting unrelated project records to users", () => {
    const state = buildInitialState("live");
    state.appAdmins = [{ email: "added@webflow.com", invitedBy: "matthew@webflow.com", invitedAt: "2026-08-11T00:00:00.000Z" }];
    expect(accessFromRegistryState({ email: "added@webflow.com", source: "development" }, state).isAppAdmin).toBe(true);
    expect(accessFromRegistryState({ email: "other@webflow.com", source: "development" }, state).isAppAdmin).toBe(false);
  });
});
