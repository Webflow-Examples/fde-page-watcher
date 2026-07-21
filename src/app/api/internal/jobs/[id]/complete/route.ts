import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/internalAccess";
import { commitCollectionResult, failCollectionJob } from "@/lib/collectionJobs";
import { getStore } from "@/lib/store";
import type { CollectionResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = authorizeInternalRequest(request);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { result?: CollectionResult };
  if (!body.result || body.result.jobId !== id) return NextResponse.json({ error: "valid result is required" }, { status: 400 });
  const dataStore = getStore();
  try {
    const state = await dataStore.getState();
    const job = (state.jobs ?? []).find((item) => item.id === id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    const [mobile, desktop] = await Promise.all([
      dataStore.getReport(job.pageId, `job-${id}-mobile`),
      dataStore.getReport(job.pageId, `job-${id}-desktop`),
    ]);
    if (!mobile || !desktop) return NextResponse.json({ error: "strategy reports are incomplete" }, { status: 409 });
    await commitCollectionResult(body.result, { strategies: { mobile, desktop } }, dataStore);
    await Promise.all([
      dataStore.deleteReport(job.pageId, `job-${id}-mobile`),
      dataStore.deleteReport(job.pageId, `job-${id}-desktop`),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await failCollectionJob(id, error, dataStore).catch(() => undefined);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
