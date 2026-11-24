import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { alertWebhookUrlIsValid } from "@/lib/webhook";
import { connectionAad, randomSecret, sealSecret } from "@/lib/integrations/crypto";
import { integrationSecret } from "@/lib/integrations/server";
import { publicSettings } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configure the outbound signed-event webhook.
 *
 * Setting a new URL issues a new signing secret and returns it once; the
 * receiver needs it to verify `X-PageWatch-Signature`. An empty URL turns the
 * stream off and drops the secret. Re-posting the same URL keeps the existing
 * secret rather than silently breaking every receiver that already has it.
 */
export async function POST(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const body = (await req.json().catch(() => ({}))) as { url?: unknown };
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be a string" }, { status: 400 });
    }
    const url = body.url.trim();
    if (url && !alertWebhookUrlIsValid(url)) {
      return NextResponse.json({ error: "Enter a valid HTTPS URL without embedded credentials" }, { status: 400 });
    }
    const store = getIntegrationStore(project.id);
    const current = await store.getSettings();
    const at = new Date().toISOString();

    if (!url) {
      const settings = await store.saveSettings({
        ...current,
        webhookUrl: undefined,
        webhookSecretEncrypted: undefined,
        webhookSecretNonce: undefined,
        updatedAt: at,
      });
      return NextResponse.json({ settings: publicSettings(settings) });
    }

    const unchanged = current.webhookUrl === url && current.webhookSecretEncrypted && current.webhookSecretNonce;
    const secret = unchanged ? undefined : randomSecret();
    const sealed = secret ? sealSecret(secret, integrationSecret(), connectionAad(project.id, "webhook")) : undefined;
    const settings = await store.saveSettings({
      ...current,
      webhookUrl: url,
      ...(sealed ? { webhookSecretEncrypted: sealed.ciphertext, webhookSecretNonce: sealed.nonce } : {}),
      updatedAt: at,
    });
    return NextResponse.json({
      settings: publicSettings(settings),
      ...(secret ? { secret } : {}),
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
