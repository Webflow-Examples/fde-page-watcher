import { NextResponse } from "next/server";
import { runPage } from "@/lib/collector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** On-demand single-page run: same five-run per-strategy path (REQ-054). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const state = await runPage(id);
    return NextResponse.json({ state, ran: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
