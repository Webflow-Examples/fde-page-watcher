import { NextResponse, after } from "next/server";
import { executePageRun } from "@/lib/collector";
import { createAfterJobRunner } from "@/lib/jobs";
import { markRunFinished, requestPageRun } from "@/lib/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * On-demand single-page run (REQ-054): asynchronous. Mark the page running,
 * return 202 immediately, and execute through the replaceable job-runner
 * boundary. The local adapter uses `after()`; it is lifecycle deferral, not a
 * durable queue. Duplicate requests coalesce onto the active run id.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const request = await requestPageRun(id);
    if (request.queued) {
      createAfterJobRunner(after).enqueue(async () => {
        try {
          await executePageRun(id, request.runId);
        } catch (err) {
          console.error(`[run] ${id} failed`, err);
          await markRunFinished(id, request.runId, String(err).slice(0, 500));
        }
      });
    }
    return NextResponse.json(
      { state: request.state, queued: request.queued, coalesced: request.coalesced, runId: request.runId },
      { status: 202 },
    );
  } catch (err) {
    const message = String(err);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 500 });
  }
}
