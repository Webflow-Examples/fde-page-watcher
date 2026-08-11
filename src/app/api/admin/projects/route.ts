import { NextResponse } from "next/server";
import { adminProjects, archiveProject, availableProjects, createManagedProject, renameProject, restoreProject } from "@/lib/projects";
import { accessErrorStatus, isAccessError, requireAppAdmin } from "@/lib/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAppAdmin(request);
    const [projects, allProjects] = await Promise.all([availableProjects(), adminProjects()]);
    return NextResponse.json({ projects, adminProjects: allProjects });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: isAccessError(error) ? accessErrorStatus(error) : 500 });
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    action?: unknown;
    name?: unknown;
    customer?: unknown;
  } | null;
  if (typeof body?.id !== "string") {
    return NextResponse.json({ error: "Project id is required" }, { status: 400 });
  }
  try {
    await requireAppAdmin(request);
    if (body.action === "rename" && typeof body.name === "string") {
      if (body.customer !== undefined && typeof body.customer !== "string") {
        return NextResponse.json({ error: "Customer must be a string" }, { status: 400 });
      }
      return NextResponse.json(await renameProject(body.id, body.name, body.customer));
    }
    if (body.action === "archive") return NextResponse.json(await archiveProject(body.id));
    if (body.action === "restore") return NextResponse.json(await restoreProject(body.id));
    return NextResponse.json({ error: "Unknown project action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = isAccessError(error) ? accessErrorStatus(error) : message.includes("Unknown project") ? 404
      : message.includes("already") || message.includes("At least one") ? 409
        : message.includes("required") || message.includes("120") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown; customer?: unknown } | null;
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }
  if (body.customer !== undefined && typeof body.customer !== "string") {
    return NextResponse.json({ error: "Customer must be a string" }, { status: 400 });
  }
  try {
    await requireAppAdmin(request);
    return NextResponse.json(await createManagedProject(body.name, body.customer), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = isAccessError(error) ? accessErrorStatus(error) : message.includes("required") || message.includes("120") ? 400 : message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
