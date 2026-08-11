import { NextResponse } from "next/server";
import { normalizeEmail, validEmail } from "@/lib/identity";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  if (typeof body?.email !== "string" || !validEmail(body.email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  const response = NextResponse.json({ email: normalizeEmail(body.email) });
  response.cookies.set("page-watch-dev-email", normalizeEmail(body.email), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}
