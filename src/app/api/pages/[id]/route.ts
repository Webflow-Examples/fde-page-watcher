import { NextResponse } from "next/server";
import { removePage, setPageTitle } from "@/lib/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RenameBody {
  title?: string;
}

/** Rename a page without changing its permanent watched URL. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as RenameBody;
  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (title.length > 120) {
    return NextResponse.json({ error: "title must be 120 characters or fewer" }, { status: 400 });
  }
  try {
    const state = await setPageTitle(id, title);
    return NextResponse.json({ state });
  } catch (err) {
    const message = String(err);
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 500 },
    );
  }
}

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
