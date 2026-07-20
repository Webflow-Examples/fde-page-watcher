import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KV read model: latest snapshots per strategy, baselines, watchlist config,
// and the recommendation lifecycle (REQ-005). All access is tenant-scoped.
//
// Read-only. Mutations go through targeted domain endpoints (/api/pages,
// /api/recs, /api/pages/[id]/*) which read-modify-write server-side, so a
// stale client can never overwrite data collected by a concurrent nightly run
// (audit High #2). The client polls this endpoint for the authoritative state.

export async function GET() {
  const state = await getStore().getState();
  return NextResponse.json({ state });
}
