import { NextResponse } from "next/server";
import { setAgentIgnore } from "@/lib/mutations";
import type { AgentIgnoreScope } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  scope?: AgentIgnoreScope;
  value?: string;
  ignored?: boolean;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.scope !== "check" && body.scope !== "group") {
    return NextResponse.json({ error: "scope must be 'check' or 'group'" }, { status: 400 });
  }
  const value = body.value?.trim();
  if (!value) return NextResponse.json({ error: "value is required" }, { status: 400 });
  if (typeof body.ignored !== "boolean") {
    return NextResponse.json({ error: "ignored must be a boolean" }, { status: 400 });
  }

  try {
    const state = await setAgentIgnore(id, body.scope, value, body.ignored);
    return NextResponse.json({ state });
  } catch (error) {
    const message = String(error);
    const status = message.includes(`page ${id} not found`) ? 404 : message.includes("does not exist") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
