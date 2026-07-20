import { NextResponse } from "next/server";
import { setPageFlag } from "@/lib/mutations";
import type { Flag } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  flag?: Flag;
}

/** Set a page's watch flag (priority / watching). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.flag !== "priority" && body.flag !== "watching") {
    return NextResponse.json({ error: "flag must be 'priority' or 'watching'" }, { status: 400 });
  }
  try {
    const state = await setPageFlag(id, body.flag);
    return NextResponse.json({ state });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
