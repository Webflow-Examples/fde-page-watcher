import { NextResponse } from "next/server";
import { authorizeInternalRequest } from "@/lib/internalAccess";
import { enrichRecommendations, generateWatcherNote } from "@/lib/collector";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = authorizeInternalRequest(request);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status });
  const { id } = await params;
  const dataStore = getStore();
  const snapshot = await dataStore.getState();
  const job = (snapshot.jobs ?? []).find((item) => item.id === id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.state !== "succeeded") return NextResponse.json({ error: "job is not complete" }, { status: 409 });
  if (job.enrichedAt) return NextResponse.json({ ok: true, coalesced: true });
  try {
    await Promise.all([
      enrichRecommendations(dataStore, job.pageId),
      generateWatcherNote(dataStore, new Date()),
    ]);
    await dataStore.updateState((draft) => {
      const current = (draft.jobs ?? []).find((item) => item.id === id);
      if (current?.state === "succeeded") {
        current.enrichedAt = new Date().toISOString();
        delete current.enrichmentError;
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await dataStore.updateState((draft) => {
      const current = (draft.jobs ?? []).find((item) => item.id === id);
      if (current) current.enrichmentError = String(error).slice(0, 500);
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
