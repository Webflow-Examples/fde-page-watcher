import { NextResponse } from "next/server";
import { setVisitorExperienceVisible } from "@/lib/mutations";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { visible?: unknown };
  if (typeof body.visible !== "boolean") {
    return NextResponse.json({ error: "visible must be a boolean" }, { status: 400 });
  }
  try {
    return NextResponse.json({ state: await setVisitorExperienceVisible(body.visible, await projectStore(req)) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
