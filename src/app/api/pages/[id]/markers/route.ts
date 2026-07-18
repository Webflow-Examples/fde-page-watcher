import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { scheduleFollowUps } from "@/lib/followups";
import { shortDate } from "@/lib/ui";
import type { TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Body {
  text: string;
  date?: string;
  recKey?: string; // when the marker comes from completing a task
  taskStatus?: TaskStatus;
}

/**
 * Log a change marker (REQ-042): appended to sequential storage + the KV read
 * model, and schedules 2/7/30-day follow-up comparisons (REQ-044). When it
 * originates from completing a task, the task's status is updated too (REQ-043).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Body;
  if (!body?.text?.trim()) {
    return NextResponse.json({ error: "marker text is required" }, { status: 400 });
  }
  const s = getStore();
  const pre = await s.getState();
  const page = pre.pages.find((p) => p.id === id);
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });

  const date = body.date?.trim() || shortDate();
  const marker = { i: Math.max(0, page.history.length - 1), date, text: body.text.trim() };

  // Sequential append + KV update (returns the updated state).
  const state = await s.addMarker(id, marker);

  if (body.recKey) {
    state.recs = state.recs.map((r) =>
      r.key === body.recKey ? { ...r, taskStatus: body.taskStatus ?? r.taskStatus, doneDate: body.taskStatus === "done" ? date : r.doneDate } : r,
    );
  }
  state.followUps = [...(state.followUps ?? []), ...scheduleFollowUps(id, marker.text, date)];
  await s.saveState(state);

  return NextResponse.json({ state });
}
