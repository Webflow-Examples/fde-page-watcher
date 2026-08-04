import { NextResponse } from "next/server";
import { setPagePerformanceThresholdOverrides } from "@/lib/mutations";
import { performanceThresholdOverridesAreValid } from "@/lib/performanceThresholds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => null);
  if (!performanceThresholdOverridesAreValid(body)) {
    return NextResponse.json({ error: "One or more page overrides are outside the supported range" }, { status: 400 });
  }
  try {
    const { id } = await params;
    return NextResponse.json({ state: await setPagePerformanceThresholdOverrides(id, body) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
