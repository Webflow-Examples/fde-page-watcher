import { NextResponse } from "next/server";
import { setAlertWebhookUrl } from "@/lib/mutations";
import { alertWebhookUrlIsValid } from "@/lib/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== "string") {
    return NextResponse.json({ error: "url must be a string" }, { status: 400 });
  }
  const url = body.url.trim();
  if (url && !alertWebhookUrlIsValid(url)) {
    return NextResponse.json(
      { error: "Enter a valid HTTPS URL without embedded credentials" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({ state: await setAlertWebhookUrl(url) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
