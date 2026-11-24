import { NextResponse } from "next/server";
import { AuthorizationError, accessErrorStatus, isAccessError } from "../authorization";
import { CaseDecisionError } from "../case-decisions";
import { CaseTransitionError } from "../case-transitions";
import { ProviderError } from "./provider";
import { TaskBatchLimitError } from "./tasks";
import { AutomationSettingsError } from "./settings";
import { IntegrationCryptoError } from "./crypto";
import { openSecret, connectionAad } from "./crypto";
import type { IntegrationConnectionRecord, IntegrationSettingsRecord } from "./types";
import type { IntegrationStore } from "./store";
import type { TaskProvider } from "./provider";

/**
 * One error-to-status mapping for every integration route.
 *
 * A malformed request is the caller's fault and says which field; a provider
 * failure is upstream and is not dressed up as our validation; anything else is
 * ours. `ProviderError` with a 429 or 5xx status keeps that status so a
 * receiving automation can retry.
 */

export class IntegrationRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "IntegrationRequestError";
    this.status = status;
  }
}

export function integrationErrorResponse(error: unknown): NextResponse {
  if (isAccessError(error)) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Access denied" }, { status: accessErrorStatus(error) });
  }
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    error instanceof IntegrationRequestError
    || error instanceof CaseDecisionError
    || error instanceof CaseTransitionError
    || error instanceof TaskBatchLimitError
    || error instanceof AutomationSettingsError
  ) {
    return NextResponse.json({ error: error.message }, { status: error instanceof IntegrationRequestError ? error.status : 400 });
  }
  if (error instanceof ProviderError) {
    return NextResponse.json(
      { error: error.message, ...(error.body ? { detail: error.body } : {}) },
      { status: error.status === 429 ? 429 : error.status >= 500 ? 502 : 400 },
    );
  }
  if (error instanceof IntegrationCryptoError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ error: String(error).slice(0, 500) }, { status: 500 });
}

export function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

/** The callback URL exactly as this deployment serves it, base path included. */
export function callbackUrl(request: Request, provider: string): string {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/oauth\/start\/?$/, "/oauth/callback");
  if (!url.pathname.endsWith("/oauth/callback")) {
    url.pathname = `/api/integrations/${provider}/oauth/callback`;
  }
  return url.toString();
}

export async function connectionFor(
  store: IntegrationStore,
  provider?: string,
): Promise<IntegrationConnectionRecord> {
  const connections = await store.listConnections();
  const connection = provider
    ? connections.find((candidate) => candidate.provider === provider)
    : connections.find((candidate) => candidate.status !== "disconnected");
  if (!connection) {
    throw new IntegrationRequestError("No task tool is connected for this project. Connect one in Settings.", 409);
  }
  return connection;
}

export async function providerFor(
  connection: IntegrationConnectionRecord,
  deps: { providerFactory?: (connection: IntegrationConnectionRecord) => TaskProvider } = {},
): Promise<TaskProvider> {
  if (deps.providerFactory) return deps.providerFactory(connection);
  const { providerForConnection } = await import("./server");
  return providerForConnection(connection);
}

export async function decryptedWebhookSecret(settings: IntegrationSettingsRecord): Promise<string | undefined> {
  if (!settings.webhookSecretEncrypted || !settings.webhookSecretNonce) return undefined;
  // Imported lazily so a route test that mocks the store never needs the
  // Cloudflare context module. `server.ts` is the only reader of the env.
  const { integrationSecret } = await import("./server");
  return openSecret(
    { ciphertext: settings.webhookSecretEncrypted, nonce: settings.webhookSecretNonce },
    integrationSecret(),
    connectionAad(settings.projectId, "webhook"),
  );
}
