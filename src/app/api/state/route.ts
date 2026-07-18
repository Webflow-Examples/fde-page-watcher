import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import type { AppState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KV read model: latest snapshots per strategy, baselines, watchlist config,
// and the recommendation lifecycle (REQ-005). All access is tenant-scoped.

export async function GET() {
  const state = await getStore().getState();
  return NextResponse.json({ state });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as AppState;
  if (!body || !Array.isArray(body.pages) || !Array.isArray(body.recs)) {
    return NextResponse.json({ error: "invalid state" }, { status: 400 });
  }
  await getStore().saveState(body);
  return NextResponse.json({ state: body });
}
