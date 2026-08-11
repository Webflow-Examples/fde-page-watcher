import { NextResponse } from "next/server";
import { setNativeElementDisposition } from "@/lib/mutations";
import type { NativeElementDisposition } from "@/lib/types";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  findingId?: string;
  disposition?: NativeElementDisposition | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  const findingId = body.findingId?.trim();
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  if (body.disposition !== null && body.disposition !== "acknowledged" && body.disposition !== "suppressed") {
    return NextResponse.json({ error: "disposition must be 'acknowledged', 'suppressed', or null" }, { status: 400 });
  }

  try {
    const state = await setNativeElementDisposition(id, findingId, body.disposition ?? null, projectStore(req));
    return NextResponse.json({ state });
  } catch (error) {
    const message = String(error);
    const status = message.includes(`page ${id} not found`) ? 404 : message.includes("does not exist") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
