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
  try {
    const state = await addPage({ title: body.title, url: body.url, flag: body.flag === "watching" ? "watching" : "priority" });
    return NextResponse.json({ state });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
