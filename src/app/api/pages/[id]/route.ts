import { NextResponse } from "next/server";
import { removePage } from "@/lib/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remove a page from the watchlist (and its recs / follow-ups). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const state = await removePage(id);
    return NextResponse.json({ state });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
