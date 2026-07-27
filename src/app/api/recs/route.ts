import { NextResponse } from "next/server";
import { advanceTask, setRecStatus } from "@/lib/mutations";
import type { TaskStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  key?: string;
  action?: "save" | "ignore" | "advance";
  to?: TaskStatus;
}

/**
 * Recommendation lifecycle mutations (server-side, keyed by rec key which may
 * contain a colon so it travels in the body, not the path):
 *   - save    -> move Inbox rec to Tasks (taskStatus resets to "todo")
 *   - ignore  -> mark Inbox rec ignored
 *   - advance -> move a task between todo / in-progress. Reopening a completed
 *                task also removes its conditional marker and follow-ups.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  try {
    if (body.action === "save") return NextResponse.json({ state: await setRecStatus(body.key, "task") });
    if (body.action === "ignore") return NextResponse.json({ state: await setRecStatus(body.key, "ignored") });
    if (body.action === "advance") {
      if (body.to !== "todo" && body.to !== "in-progress") {
        return NextResponse.json({ error: "advance 'to' must be 'todo' or 'in-progress'" }, { status: 400 });
      }
      return NextResponse.json({ state: await advanceTask(body.key, body.to) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
