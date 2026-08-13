import { NextResponse } from "next/server";
import { DEVELOPMENT_SESSION_COOKIE, PRODUCTION_SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true, redirectTo: "/login" }, {
    headers: { "cache-control": "no-store" },
  });
  for (const name of [PRODUCTION_SESSION_COOKIE, DEVELOPMENT_SESSION_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: name === PRODUCTION_SESSION_COOKIE,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
