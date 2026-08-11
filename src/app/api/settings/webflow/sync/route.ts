import { relayWebflowCollector, requestWebflowCollector } from "@/lib/webflowConnectionServer";
import { authorizedProjectForRequest } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return relayWebflowCollector(await requestWebflowCollector("sync", { method: "POST" }, fetch, (await authorizedProjectForRequest(request, "admin")).tenant));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Webflow sync is unavailable" },
      { status: 503 },
    );
  }
}
