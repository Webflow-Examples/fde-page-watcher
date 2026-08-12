import { NextResponse } from "next/server";
import { generateLoginState, loginStateCookieName, loginStateCookieOptions } from "@/lib/authHandoff";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function brokerUrl(): URL {
  const configured = getEnv("AUTH_BROKER_URL")?.trim();
  if (!configured) throw new Error("AUTH_BROKER_URL is not configured");
  const url = new URL(configured);
  const local = process.env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("AUTH_BROKER_URL must be a secure origin URL");
  }
  return url;
}

export async function GET() {
  try {
    const state = generateLoginState();
    const destination = new URL("/__auth/broker", brokerUrl());
    destination.searchParams.set("state", state);
    const response = NextResponse.redirect(destination, 303);
    response.headers.set("cache-control", "no-store");
    response.cookies.set(loginStateCookieName(), state, loginStateCookieOptions());
    return response;
  } catch (error) {
    console.error("Authentication broker start failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: "Authentication is temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
