import { NextResponse } from "next/server";
import { addPage } from "@/lib/mutations";
import type { Flag } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  title?: string;
  url?: string;
  flag?: Flag;
}

/** Add a watched page (server-side domain mutation; replaces whole-state PUT). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.title?.trim() || !body.url?.trim()) {
    return NextResponse.json({ error: "title and url are required" }, { status: 400 });
  }
  if (body.flag !== undefined && body.flag !== "priority" && body.flag !== "watching" && body.flag !== "paused") {
    return NextResponse.json({ error: "flag must be 'priority', 'watching', or 'paused'" }, { status: 400 });
  }
  try {
    const state = await addPage({ title: body.title, url: body.url, flag: body.flag });
    return NextResponse.json({ state });
  } catch (err) {
    const message = String(err);
    return NextResponse.json({ error: message }, { status: message.includes("Only ") ? 409 : 500 });
  }
}
