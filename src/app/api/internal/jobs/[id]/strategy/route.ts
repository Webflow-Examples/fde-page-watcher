import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/internalAccess";
import { getStore } from "@/lib/store";
import type { Strategy } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  runId?: string;
  strategy?: Strategy;
  result?: unknown;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = authorizeInternalRequest(request);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  if ((body.strategy !== "mobile" && body.strategy !== "desktop") || !body.runId || !body.result) {
    return NextResponse.json({ error: "runId, strategy, and result are required" }, { status: 400 });
  }
  try {
    const dataStore = getStore();
    const state = await dataStore.getState();
    const job = (state.jobs ?? []).find((item) => item.id === id);
    if (!job || job.runId !== body.runId) return NextResponse.json({ error: "job not found" }, { status: 404 });
    if (job.state === "failed") return NextResponse.json({ error: "job is no longer active" }, { status: 409 });
    await dataStore.putReport(job.pageId, `job-${id}-${body.strategy}`, body.result);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
