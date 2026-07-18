import { NextResponse } from "next/server";
import { captureBaseline } from "@/lib/collector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Capture (or re-capture) a baseline via the five-run median path (REQ-012). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const state = await captureBaseline(id);
    return NextResponse.json({ state, captured: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
