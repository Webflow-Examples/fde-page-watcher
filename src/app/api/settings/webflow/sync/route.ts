import { relayWebflowCollector, requestWebflowCollector } from "@/lib/webflowConnectionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    return relayWebflowCollector(await requestWebflowCollector("sync", { method: "POST" }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Webflow sync is unavailable" },
      { status: 503 },
    );
  }
}
