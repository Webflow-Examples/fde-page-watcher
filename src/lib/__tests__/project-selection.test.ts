import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_SELECTION_COOKIE,
  PROJECT_SELECTION_TTL_SECONDS,
  projectSelectionCookieOptions,
} from "../projectSelection";

describe("project selection persistence", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses a long-lived HttpOnly cookie scoped to the whole app", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(PROJECT_SELECTION_COOKIE).toBe("page-watch-project");
    expect(projectSelectionCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: PROJECT_SELECTION_TTL_SECONDS,
    });
  });
});
