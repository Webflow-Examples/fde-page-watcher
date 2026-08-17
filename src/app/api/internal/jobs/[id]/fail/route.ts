import { NextResponse } from "next/server";
import { authorizeInternalRequest, internalProjectStore } from "@/lib/internalAccess";
import { failCollectionJob } from "@/lib/collectionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = authorizeInternalRequest(request);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { error?: string };
  const dataStore = await internalProjectStore(request).catch(() => null);
  if (!dataStore) return NextResponse.json({ error: "known tenant is required" }, { status: 400 });
  await failCollectionJob(id, body.error || "Collector workflow failed", dataStore);
  return NextResponse.json({ ok: true });
}
