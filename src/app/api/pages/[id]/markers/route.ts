import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import { scheduleFollowUps } from "@/lib/followups";
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
