import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { accessForIdentity } from "@/lib/authorization";
import { loginStateCookieName, loginStateCookieOptions, verifyAuthHandoff } from "@/lib/authHandoff";
import { getEnv } from "@/lib/env";
import { createSessionToken, sessionCookieName, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(request: NextRequest): string {
  const configured = getEnv("AUTH_PUBLIC_ORIGIN")?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_PUBLIC_ORIGIN is not configured");
  }
  const url = new URL(configured || request.nextUrl.origin);
  const local = process.env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("AUTH_PUBLIC_ORIGIN must be a secure origin URL");
  }
  return url.origin;
}

function redirectAndClearState(origin: string, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, origin), 303);
  response.headers.set("cache-control", "no-store");
  response.cookies.set(loginStateCookieName(), "", { ...loginStateCookieOptions(), maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  let origin: string;
  try {
    origin = publicOrigin(request);
  } catch (error) {
    console.error("Authentication callback origin is invalid", error instanceof Error ? error.message : String(error));
    return new NextResponse("Authentication is not configured", { status: 503, headers: { "cache-control": "no-store" } });
  }

  const token = request.nextUrl.searchParams.get("token") ?? "";
  const state = request.cookies.get(loginStateCookieName())?.value ?? "";
  try {
    const secret = getEnv("AUTH_HANDOFF_SECRET") ?? "";
    const handoff = await verifyAuthHandoff(token, { secret, audience: origin, state });
    const access = await accessForIdentity({
      email: handoff.email,
      ...(handoff.sub ? { subject: handoff.sub } : {}),
      source: "session",
    });
    if (!access.isAppAdmin && Object.keys(access.projectRoles).length === 0) {
      return redirectAndClearState(origin, "/login?error=access");
    }
    const response = redirectAndClearState(origin, "/dashboard");
    response.cookies.set(sessionCookieName(), await createSessionToken(handoff.email), sessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Authentication handoff verification failed", error instanceof Error ? error.message : String(error));
    return redirectAndClearState(origin, "/login?error=handoff");
  }
}
