import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import { resolveMarkerIndex, scheduleFollowUps } from "@/lib/followups";
import { isoDate, normalizeISODate } from "@/lib/ui";
import type { TaskStatus } from "@/lib/types";

export const runtime = "nodejs";
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
  const date = normalizeISODate(body.date?.trim() || isoDate());
  if (!date) return NextResponse.json({ error: "marker date must be a valid ISO date" }, { status: 400 });
  const marker = {
    id: randomUUID(),
    date,
    text: body.text.trim(),
    source: body.recKey ? "task" as const : "custom" as const,
    ...(body.recKey ? { recKey: body.recKey } : {}),
  };

  try {
    const state = await getStore().addMarker(id, marker, (draft, committed) => {
      if (body.recKey) {
        const rec = draft.recs.find((item) => item.key === body.recKey);
        if (rec) {
          rec.taskStatus = body.taskStatus ?? rec.taskStatus;
          rec.doneDate = body.taskStatus === "done" ? date : rec.doneDate;
        }
      }
      draft.followUps = [...(draft.followUps ?? []), ...scheduleFollowUps(id, committed)];
    });
    return NextResponse.json({ state });
  } catch (error) {
    const message = String(error);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { markerId?: string; text?: string; date?: string };
  const text = body.text?.trim();
  const date = normalizeISODate(body.date?.trim() ?? "");
  if (!body.markerId || !text || !date) {
    return NextResponse.json({ error: "marker id, text, and a valid ISO date are required" }, { status: 400 });
  }
  try {
    const store = getStore();
    const state = await store.updateState((draft) => {
      const page = draft.pages.find((item) => item.id === id);
      if (!page) throw new Error(`page ${id} not found`);
      const marker = page.markers.find((item) => item.id === body.markerId);
      if (!marker) throw new Error(`marker ${body.markerId} not found`);
      if (marker.source === "task" || marker.recKey || marker.text.startsWith("Acted:")) throw new Error("task markers cannot be edited");
      marker.text = text;
      marker.date = date;
      marker.i = resolveMarkerIndex(page.history, date);
      for (const followUp of draft.followUps ?? []) {
        if (followUp.markerId !== marker.id) continue;
        followUp.markerText = text;
        followUp.markerDate = date;
        const days = followUp.interval === "2d" ? 2 : followUp.interval === "7d" ? 7 : 30;
        followUp.dueISO = new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000 > 0
          ? new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString()
          : followUp.dueISO;
      }
    });
    return NextResponse.json({ state });
  } catch (error) {
    const message = String(error);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
