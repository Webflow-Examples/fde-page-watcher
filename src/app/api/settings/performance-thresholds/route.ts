import { NextResponse } from "next/server";
import { setPerformanceThresholds } from "@/lib/mutations";
import { performanceThresholdsAreValid } from "@/lib/performanceThresholds";
import type { PerformanceThresholds } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<PerformanceThresholds>;
  if (!performanceThresholdsAreValid(body)) {
    return NextResponse.json(
      { error: "One or more monitoring tolerances are missing or outside the supported range" },
      { status: 400 },
    );
  }

  try {
    const state = await setPerformanceThresholds(body);
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
