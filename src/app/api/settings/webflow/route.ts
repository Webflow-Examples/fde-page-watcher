import { relayWebflowCollector, requestWebflowCollector } from "@/lib/webflowConnectionServer";
import { authorizedProjectForRequest } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unavailable(error: unknown): Promise<Response> {
  return Response.json(
    { error: error instanceof Error ? error.message : "Webflow connection is unavailable" },
    { status: 503 },
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    return relayWebflowCollector(await requestWebflowCollector(
      "connection",
      (await authorizedProjectForRequest(request, "admin")).tenant,
    ));
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 16 * 1024) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 16 * 1024) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    !input
    || typeof input !== "object"
    || typeof (input as { siteId?: unknown }).siteId !== "string"
    || typeof (input as { token?: unknown }).token !== "string"
  ) {
    return Response.json({ error: "Site ID and token are required" }, { status: 400 });
  }
  try {
    return relayWebflowCollector(await requestWebflowCollector(
      "connection",
      (await authorizedProjectForRequest(request, "admin")).tenant,
      {
      method: "POST",
      body: JSON.stringify({
        siteId: (input as { siteId: string }).siteId,
        token: (input as { token: string }).token,
      }),
      },
    ));
  } catch (error) {
    return unavailable(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    return relayWebflowCollector(await requestWebflowCollector(
      "connection",
      (await authorizedProjectForRequest(request, "admin")).tenant,
      { method: "DELETE" },
    ));
  } catch (error) {
    return unavailable(error);
  }
}
