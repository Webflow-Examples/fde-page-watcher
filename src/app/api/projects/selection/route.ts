import { NextResponse } from "next/server";
import { authorizedProjectForRequest, isProjectAccessError } from "@/lib/projects";
import { PROJECT_SELECTION_COOKIE, projectSelectionCookieOptions } from "@/lib/projectSelection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { projectId?: unknown };
  if (typeof body.projectId !== "string" || !body.projectId) {
    return NextResponse.json({ error: "Select a project" }, { status: 400 });
  }

  const projectUrl = new URL(request.url);
  projectUrl.searchParams.set("project", body.projectId);
  let project;
  try {
    project = await authorizedProjectForRequest(new Request(projectUrl, { headers: request.headers }), "viewer");
  } catch (error) {
    if (isProjectAccessError(error)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    throw error;
  }

  const response = NextResponse.json({ projectId: project.id }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(PROJECT_SELECTION_COOKIE, project.id, projectSelectionCookieOptions());
  return response;
}
