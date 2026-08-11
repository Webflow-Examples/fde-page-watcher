import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { projectStore } from "@/lib/projects";
import { resolveMarkerIndex, scheduleFollowUps } from "@/lib/followups";
import { isoDate, normalizeISODate } from "@/lib/ui";
import type { TaskStatus } from "@/lib/types";
import { isTaskMarker, taskMarkerText } from "@/lib/taskMarkers";

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
    text: body.recKey ? taskMarkerText(body.text.trim().replace(/^(?:Acted|Completed):\s*/, "")) : body.text.trim(),
    source: body.recKey ? "task" as const : "custom" as const,
    ...(body.recKey ? { recKey: body.recKey } : {}),
  };

  try {
    const state = await projectStore(req).addMarker(id, marker, (draft, committed) => {
      if (body.recKey) {
        const rec = draft.recs.find((item) => item.key === body.recKey);
        if (!rec) throw new Error(`task ${body.recKey} not found`);
        if (body.taskStatus !== "done") throw new Error("task marker requires a completed task");
        rec.taskStatus = "done";
        rec.doneDate = date;
      }
      const scheduled = scheduleFollowUps(id, committed);
      const existingByInterval = new Map(
        (draft.followUps ?? [])
          .filter((followUp) => followUp.markerId === committed.id)
          .map((followUp) => [followUp.interval, followUp]),
      );
      const missing: ReturnType<typeof scheduleFollowUps> = [];
      for (const desired of scheduled) {
        const existing = existingByInterval.get(desired.interval);
        if (!existing) {
          missing.push(desired);
          continue;
        }
        existing.markerText = desired.markerText;
        existing.markerDate = desired.markerDate;
        existing.dueISO = desired.dueISO;
      }
      draft.followUps = [...(draft.followUps ?? []), ...missing];
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
    const store = projectStore(req);
    const state = await store.updateState((draft) => {
      const page = draft.pages.find((item) => item.id === id);
      if (!page) throw new Error(`page ${id} not found`);
      const marker = page.markers.find((item) => item.id === body.markerId);
      if (!marker) throw new Error(`marker ${body.markerId} not found`);
      if (isTaskMarker(marker)) throw new Error("task markers cannot be edited");
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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { markerId?: string };
  if (!body.markerId) {
    return NextResponse.json({ error: "marker id is required" }, { status: 400 });
  }
  try {
    const state = await projectStore(req).updateState((draft) => {
      const page = draft.pages.find((item) => item.id === id);
      if (!page) throw new Error(`page ${id} not found`);
      const marker = page.markers.find((item) => item.id === body.markerId);
      if (!marker) throw new Error(`marker ${body.markerId} not found`);
      if (isTaskMarker(marker)) throw new Error("task markers are controlled by task completion");
      page.markers = page.markers.filter((item) => item.id !== marker.id);
      draft.followUps = (draft.followUps ?? []).filter((followUp) => followUp.markerId !== marker.id);
    });
    return NextResponse.json({ state });
  } catch (error) {
    const message = String(error);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
