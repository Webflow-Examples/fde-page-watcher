import { NextResponse } from "next/server";
import { escalationMarkdown } from "@/lib/escalations";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function filename(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${safe || "product-escalation"}.md`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await projectStore(req).getState();
  const escalation = (state.productEscalations ?? []).find((item) => item.id === id);
  if (!escalation) return NextResponse.json({ error: "escalation not found" }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format");
  if (format === "json") return NextResponse.json({ escalation, packet: escalation.evidence });
  return new Response(escalationMarkdown(escalation), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename(escalation.title)}"`,
      "cache-control": "no-store",
    },
  });
}
