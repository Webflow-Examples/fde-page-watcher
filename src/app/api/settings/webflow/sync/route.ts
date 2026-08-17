import { relayWebflowCollector, requestWebflowCollector } from "@/lib/webflowConnectionServer";
import { authorizedProjectForRequest } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return relayWebflowCollector(await requestWebflowCollector(
      "sync",
      (await authorizedProjectForRequest(request, "admin")).tenant,
      { method: "POST" },
    ));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Webflow sync is unavailable" },
      { status: 503 },
    );
  }
}
