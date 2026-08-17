import { NextResponse } from "next/server";
import { authorizeInternalRequest, internalProjectStore } from "@/lib/internalAccess";
import { markCollectionJob } from "@/lib/collectionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = authorizeInternalRequest(request);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status });
  const { id } = await params;
  try {
    const dataStore = await internalProjectStore(request);
    const state = await markCollectionJob(id, "running", { dataStore });
    const job = (state.jobs ?? []).find((item) => item.id === id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
