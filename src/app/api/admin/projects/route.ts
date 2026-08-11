import { NextResponse } from "next/server";
import { availableProjects, createManagedProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ projects: await availableProjects() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await createManagedProject(body.name), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("required") || message.includes("120") ? 400 : message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
