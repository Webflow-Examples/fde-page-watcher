import { NextResponse, type NextRequest } from "next/server";
import { evaluateAppAccess } from "@/lib/access";

export function proxy(request: NextRequest) {
  // Scheduled jobs use their own required bearer secret; a request cannot use
  // both that scheme and the browser-facing Basic Authorization header.
  if (request.nextUrl.pathname.endsWith("/api/cron/nightly")) return NextResponse.next();

  const decision = evaluateAppAccess(request.headers.get("authorization"));
  if (decision.allowed) return NextResponse.next();
  const headers = decision.status === 401 ? { "WWW-Authenticate": 'Basic realm="FDE Page Watcher", charset="UTF-8"' } : undefined;
  return NextResponse.json({ error: decision.message }, { status: decision.status, headers });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
