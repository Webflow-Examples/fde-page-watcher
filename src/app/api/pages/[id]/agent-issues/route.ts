import { NextResponse } from "next/server";
import { addAgentIssueTask } from "@/lib/mutations";
import { projectStore } from "@/lib/projects";
import { assembleAgentIssueCases } from "@/lib/agentIssueCases";
import { externalAuditForPage } from "@/lib/externalAgentEvidence";
import { normalizeAgentIgnoreSettings } from "@/lib/agentScoring";
import { normalizeOraTarget } from "@/lib/ora";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Promote an agent-access issue to a task.
 *
 * The client sends only the issue key. The case itself is re-assembled
 * server-side from stored evidence, so a caller cannot invent remediation
 * steps, success criteria, or verification check ids.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { caseKey?: unknown };
  if (typeof body.caseKey !== "string" || !body.caseKey) {
    return NextResponse.json({ error: "caseKey is required" }, { status: 400 });
  }
  try {
    const dataStore = await projectStore(request);
    const state = await dataStore.getState();
    const page = state.pages.find((item) => item.id === id);
    if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });

    const audits = await dataStore.getExternalAgentAudits().catch(() => []);
    const latest = [...page.history].reverse().find((night) => night.agent?.length);
    const cases = assembleAgentIssueCases({
      checks: latest?.agent ?? page.agent,
      ...(latest?.agentCapturedAt ? { checksObservedAt: latest.agentCapturedAt } : {}),
      ignores: normalizeAgentIgnoreSettings(page.agentIgnores),
      ignoreDefaults: normalizeAgentIgnoreSettings(state.agentIgnoreDefaults),
      ignoreRestores: normalizeAgentIgnoreSettings(page.agentIgnoreRestores),
      audit: externalAuditForPage(audits, page.url),
    });
    const issue = cases.find((item) => item.key === body.caseKey);
    if (!issue) return NextResponse.json({ error: "issue not found" }, { status: 404 });

    let origin: string | undefined;
    try {
      origin = normalizeOraTarget(page.url).origin;
    } catch {
      // A page whose origin cannot be audited still supports a local task.
    }
    return NextResponse.json({ state: await addAgentIssueTask(id, issue, origin, dataStore) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
