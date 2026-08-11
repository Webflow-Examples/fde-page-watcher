import { NextResponse } from "next/server";
import { createProductEscalation, updateProductEscalation } from "@/lib/mutations";
import type { ProductEscalationStatus } from "@/lib/types";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action?: "create" | "update";
  recKey?: string;
  id?: string;
  status?: ProductEscalationStatus;
  owner?: string;
  notes?: string;
  refreshEvidence?: boolean;
}

export async function POST(req: Request) {
  const dataStore = projectStore(req);
  const body = (await req.json().catch(() => ({}))) as Body;
  try {
    if (body.action === "create") {
      if (!body.recKey) return NextResponse.json({ error: "recKey is required" }, { status: 400 });
      return NextResponse.json({ state: await createProductEscalation(body.recKey, dataStore) });
    }
    if (body.action === "update") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      return NextResponse.json({ state: await updateProductEscalation(body.id, {
        status: body.status,
        owner: body.owner,
        notes: body.notes,
        refreshEvidence: body.refreshEvidence,
      }, dataStore) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    const message = String(error);
    const status = message.includes("not found") ? 404 : message.includes("invalid") || message.includes("too long") || message.includes("fixable") || message.includes("assign an owner") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
