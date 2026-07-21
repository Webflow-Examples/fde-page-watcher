import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/internalAccess";
import { failCollectionJob } from "@/lib/collectionJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = authorizeInternalRequest(request);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { error?: string };
  await failCollectionJob(id, body.error || "Collector workflow failed");
  return NextResponse.json({ ok: true });
}
