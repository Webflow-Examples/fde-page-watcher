import { NextResponse } from "next/server";
import { setSensitivity } from "@/lib/mutations";
import { isSensitivity } from "@/lib/sensitivity";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one route that changes what this site considers worth reporting.
 *
 * It takes a position, never a threshold set. That is the API surface of option
 * 10b: a client that could post twelve numbers is a client that could rebuild
 * the panel this chunk deleted, on a screen nobody reviewed.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sensitivity?: unknown };
  if (!isSensitivity(body.sensitivity)) {
    return NextResponse.json({ error: "Choose one of the three sensitivity positions" }, { status: 400 });
  }

  try {
    const state = await setSensitivity(body.sensitivity, await projectStore(req));
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
