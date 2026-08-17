import { NextResponse } from "next/server";
import { accessErrorStatus, isAccessError, requireAppAdmin } from "@/lib/authorization";
import { summarizeUnmappedWebflowFindings } from "@/lib/unmappedWebflowFindings";
import { adminProjectStores } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAppAdmin(request);
    const projects = await adminProjectStores();
    const loaded = await Promise.all(projects.map(async ({ project, dataStore }) => {
      try {
        return { project, state: await dataStore.getState(), error: null };
      } catch (error) {
        return { project, state: null, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    const findings = summarizeUnmappedWebflowFindings(loaded.flatMap((item) =>
      item.state ? [{ project: item.project, state: item.state }] : []));
    return NextResponse.json({
      days: 30,
      findings,
      unavailableProjects: loaded.filter((item) => item.error).map((item) => item.project.id),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: isAccessError(error) ? accessErrorStatus(error) : 500 },
    );
  }
}
