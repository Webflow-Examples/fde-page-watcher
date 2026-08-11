import { NextResponse } from "next/server";
import { accessErrorStatus, isAccessError, listProjectMembers, removeProjectMember, requireProjectAccess, setProjectMember } from "@/lib/authorization";
import { authorizedProjectForRequest } from "@/lib/projects";
import type { ProjectRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = isAccessError(error) ? accessErrorStatus(error) : message.includes("valid") ? 400 : message.includes("final") ? 409 : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const project = await authorizedProjectForRequest(request, "admin");
    return NextResponse.json({ members: await listProjectMembers(project.id) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const project = await authorizedProjectForRequest(request, "admin");
    const actor = await requireProjectAccess(request, project.id, "admin");
    const body = await request.json().catch(() => null) as { email?: unknown; role?: unknown } | null;
    if (typeof body?.email !== "string" || (body.role !== "project_admin" && body.role !== "project_viewer")) {
      return NextResponse.json({ error: "Email and role are required" }, { status: 400 });
    }
    const members = await setProjectMember({ projectId: project.id, email: body.email, role: body.role as ProjectRole, actor });
    return NextResponse.json({ members }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  try {
    const project = await authorizedProjectForRequest(request, "admin");
    const actor = await requireProjectAccess(request, project.id, "admin");
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    if (typeof body?.email !== "string") return NextResponse.json({ error: "Email is required" }, { status: 400 });
    return NextResponse.json({ members: await removeProjectMember(project.id, body.email, actor) });
  } catch (error) {
    return failure(error);
  }
}
