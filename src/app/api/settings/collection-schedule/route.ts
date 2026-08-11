import { NextResponse } from "next/server";
import { collectionScheduleIsValid } from "@/lib/collectionSchedule";
import { setCollectionSchedule } from "@/lib/mutations";
import type { CollectionSchedule } from "@/lib/types";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<CollectionSchedule>;
  if (!collectionScheduleIsValid(body)) {
    return NextResponse.json(
      { error: "Enter a valid collection time and IANA timezone" },
      { status: 400 },
    );
  }
  try {
    const state = await setCollectionSchedule(body, await projectStore(req));
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
