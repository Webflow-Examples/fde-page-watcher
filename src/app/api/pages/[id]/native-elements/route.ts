import { NextResponse } from "next/server";
import { setNativeElementApplicability } from "@/lib/mutations";
import { EXCLUSION_REASONS, type ExclusionReason } from "@/lib/vocabulary";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Applicability on one native-element finding.
 *
 * `reason` is the exclusion reason the registry requires; `null` includes the
 * finding again. The retired `disposition` field is gone: it carried
 * applicability and lifecycle in one value, and a dismissal now happens on the
 * case, where the lifecycle lives.
 */
interface Body {
  findingId?: string;
  reason?: ExclusionReason | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  const findingId = body.findingId?.trim();
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  const reason = body.reason ?? null;
  if (reason !== null && !(EXCLUSION_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json(
      { error: `reason must be null or one of: ${EXCLUSION_REASONS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const state = await setNativeElementApplicability(id, findingId, reason, await projectStore(req));
    return NextResponse.json({ state });
  } catch (error) {
    const message = String(error);
    const status = message.includes(`page ${id} not found`)
      ? 404
      : message.includes("does not exist") || message.includes("is not an exclusion reason")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
