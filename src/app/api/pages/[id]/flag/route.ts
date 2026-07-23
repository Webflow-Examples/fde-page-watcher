import { NextResponse } from "next/server";
import { setPageFlag } from "@/lib/mutations";
import type { Flag } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  flag?: Flag;
}

/** Set a page's watch flag (priority / watching / paused). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.flag !== "priority" && body.flag !== "watching" && body.flag !== "paused") {
    return NextResponse.json({ error: "flag must be 'priority', 'watching', or 'paused'" }, { status: 400 });
  }
  try {
    const state = await setPageFlag(id, body.flag);
    return NextResponse.json({ state });
  } catch (err) {
    const message = String(err);
    const status = message.includes("not found") ? 404 : message.includes("Only ") || message.includes("current collection") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
