import { NextRequest, NextResponse } from "next/server";
import { accessErrorStatus, accessForRequest, isAccessError, requireAppAdmin, requireProjectAccess } from "@/lib/authorization";
import { ArchivedProjectError, defaultAccessibleProject, projectForRequest, UnknownProjectError } from "@/lib/projects";

/**
 * Normalize authorization failures before a route begins domain work. Route
 * handlers still enforce access at their data boundary; this layer makes the
 * public HTTP contract consistently return 401/403/404 instead of a generic
 * framework 500 for an uncaught authorization exception.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/health") || path.startsWith("/api/cron/") || path.startsWith("/api/internal/") || path.startsWith("/api/dev/")) {
    return NextResponse.next();
  }

  try {
    if (path === "/watchlist" || path === "/settings") {
      const access = await accessForRequest(request);
      const project = await defaultAccessibleProject(access);
      if (!project || (!access.isAppAdmin && access.projectRoles[project.id] !== "project_admin")) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
      return NextResponse.next();
    }

    if (path.startsWith("/api/admin/")) {
      await requireAppAdmin(request);
      return NextResponse.next();
    }

    const project = await projectForRequest(request);
    const adminOnly = path.startsWith("/api/settings/")
      || path === "/api/page-title"
      || path.startsWith("/api/projects/members")
      || (request.method !== "GET" && request.method !== "HEAD");
    await requireProjectAccess(request, project.id, adminOnly ? "admin" : "viewer");
    return NextResponse.next();
  } catch (error) {
    if (error instanceof UnknownProjectError || error instanceof ArchivedProjectError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (isAccessError(error)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Access denied" }, { status: accessErrorStatus(error) });
    }
    throw error;
  }
}

export const config = { matcher: ["/api/:path*", "/watchlist", "/settings"] };
