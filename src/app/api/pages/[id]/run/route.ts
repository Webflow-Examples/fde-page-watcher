import { NextResponse, after } from "next/server";
import { startCollection } from "@/lib/startCollection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * On-demand collection: production dispatches a durable Workflow and returns
 * immediately; local development uses Next's `after()` as an explicit fallback.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await startCollection(id, "run", after);
    return NextResponse.json(
      { state: result.state, queued: result.queued, coalesced: result.coalesced, jobId: result.jobId },
      { status: 202 },
    );
  } catch (err) {
    const message = String(err);
    const status = message.includes("not found") ? 404 : message.includes("is paused") ? 409 : message.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
