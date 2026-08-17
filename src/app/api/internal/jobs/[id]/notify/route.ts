import { NextResponse } from "next/server";
import { authorizeInternalRequest, internalProjectStore } from "@/lib/internalAccess";
import { notifyCollectionJob, processFollowUps } from "@/lib/collector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = authorizeInternalRequest(request);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status });
  const { id } = await params;
  const dataStore = await internalProjectStore(request).catch(() => null);
  if (!dataStore) return NextResponse.json({ error: "known tenant is required" }, { status: 400 });
  try {
    await notifyCollectionJob(dataStore, id);
    await processFollowUps({ dataStore });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await dataStore.updateState((draft) => {
      const current = (draft.jobs ?? []).find((item) => item.id === id);
      if (current) current.notificationError = String(error).slice(0, 500);
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
