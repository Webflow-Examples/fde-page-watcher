import { NextResponse } from "next/server";
import { accessLogoutUrls } from "@/lib/accessLogout";
import { LOGIN_STATE_COOKIE_DEVELOPMENT, LOGIN_STATE_COOKIE_PRODUCTION } from "@/lib/authHandoff";
import { getEnv } from "@/lib/env";
import { DEVELOPMENT_SESSION_COOKIE, PRODUCTION_SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({
    ok: true,
    redirectTo: "/login?signedOut=1",
    accessLogoutUrls: accessLogoutUrls({
      brokerUrl: getEnv("AUTH_BROKER_URL"),
      teamDomain: getEnv("CF_ACCESS_TEAM_DOMAIN"),
    }),
  }, {
    headers: { "cache-control": "no-store" },
  });
  for (const name of [
    PRODUCTION_SESSION_COOKIE,
    DEVELOPMENT_SESSION_COOKIE,
    LOGIN_STATE_COOKIE_PRODUCTION,
    LOGIN_STATE_COOKIE_DEVELOPMENT,
  ]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: name.startsWith("__Host-"),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
