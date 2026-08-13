export const LAST_PROJECT_KEY = "page-watcher:last-project";
export const PROJECT_SELECTION_COOKIE = "page-watch-project";
export const PROJECT_SELECTION_TTL_SECONDS = 365 * 24 * 60 * 60;

export function projectSelectionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PROJECT_SELECTION_TTL_SECONDS,
  };
}
