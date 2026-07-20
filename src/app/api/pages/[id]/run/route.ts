import { NextResponse, after } from "next/server";
import { runPage } from "@/lib/collector";
import { markRunFinished, markRunning } from "@/lib/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * On-demand single-page run (REQ-054): asynchronous. Mark the page running,
 * return 202 immediately, and execute the collection in the background via
 * `after()`. The client polls GET /api/state until runState settles. This
 * never holds the request open for the full multi-run collection (audit
 * High #1).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const state = await markRunning(id);
    after(async () => {
      try {
        await runPage(id);
        await markRunFinished(id);
      } catch (err) {
        console.error(`[run] ${id} failed`, err);
        await markRunFinished(id, String(err));
      }
    });
    return NextResponse.json({ state, queued: true }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
