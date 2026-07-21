import { NextResponse, after } from "next/server";
import { startCollection } from "@/lib/startCollection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Queue a baseline capture through the same durable collection path as runs. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await startCollection(id, "baseline", after);
    return NextResponse.json(
      { state: result.state, queued: result.queued, coalesced: result.coalesced, jobId: result.jobId },
      { status: 202 },
    );
  } catch (err) {
    const message = String(err);
    const status = message.includes("not found") ? 404 : message.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
