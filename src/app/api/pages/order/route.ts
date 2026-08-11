import { NextResponse } from "next/server";
import { setPageOrder } from "@/lib/mutations";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  pageIds?: string[];
}

/** Persist the manual Watchlist order; flag tiers remain Priority, Watching, Paused. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!Array.isArray(body.pageIds) || body.pageIds.some((id) => typeof id !== "string" || !id)) {
    return NextResponse.json({ error: "pageIds must be an array of page ids" }, { status: 400 });
  }
  try {
    const state = await setPageOrder(body.pageIds, await projectStore(req));
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
