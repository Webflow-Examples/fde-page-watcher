import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import { scheduleFollowUps } from "@/lib/followups";
import { parseMarkerDate, shortDate } from "@/lib/ui";
import type { ChangeMarker, Night, TaskStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  text: string;
  date?: string;
  recKey?: string; // when the marker comes from completing a task
  taskStatus?: TaskStatus;
}

/**
 * Resolve which history night a marker belongs to from its DATE, not the
 * latest index (audit High #4). Picks the last night on or before the marker
 * date; falls back to the most recent night if the date can't be placed.
 */
function resolveMarkerIndex(history: Night[], markerDate: string): number {
  const target = parseMarkerDate(markerDate);
  if (!target || history.length === 0) return Math.max(0, history.length - 1);
  let idx = -1;
  for (let i = 0; i < history.length; i++) {
    const nightDate = parseMarkerDate(history[i].iso ?? history[i].date);
    if (nightDate && nightDate.getTime() <= target.getTime()) idx = i;
  }
  return idx >= 0 ? idx : 0;
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
  const marker: ChangeMarker = {
    id: randomUUID(),
    i: resolveMarkerIndex(page.history, date),
    date,
    text: body.text.trim(),
  };

  // Sequential append + KV update (returns the updated state).
  const state = await s.addMarker(id, marker);

  if (body.recKey) {
    state.recs = state.recs.map((r) =>
      r.key === body.recKey ? { ...r, taskStatus: body.taskStatus ?? r.taskStatus, doneDate: body.taskStatus === "done" ? date : r.doneDate } : r,
    );
  }
  state.followUps = [...(state.followUps ?? []), ...scheduleFollowUps(id, marker)];
  await s.saveState(state);

  return NextResponse.json({ state });
}
