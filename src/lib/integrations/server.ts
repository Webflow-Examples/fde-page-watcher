import { randomUUID } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "../env";
import { createD1IntegrationStore, createFsIntegrationStore, type IntegrationStore } from "./store";
import { connectionAad, openSecret, TOKEN_KEY_ENV } from "./crypto";
import { createAsanaProvider } from "./asana";
import { createLinearProvider } from "./linear";
import type { TaskProvider } from "./provider";
import type { IntegrationConnectionRecord, TaskProviderKind } from "./types";

/**
 * Server-only helpers: pick an adapter, decrypt a token, build a provider.
 *
 * Nothing in this module may be imported by a client component. The token never
 * leaves it: `providerForConnection` is the only reader of `encryptedToken`, and
 * it returns a provider, not a string.
 */

export function integrationSecret(): string {
  const value = getEnv(TOKEN_KEY_ENV)?.trim();
  if (!value) {
    throw new Error(
      `${TOKEN_KEY_ENV} is not set. A task-tool connection cannot be stored or read without it; see docs/task-integrations.md.`,
    );
  }
  return value;
}

export function getIntegrationStore(projectId: string): IntegrationStore {
  try {
    const { env } = getCloudflareContext();
    if (env?.DB) return createD1IntegrationStore(projectId, env.DB);
  } catch {
    // Not running on Cloudflare Workers.
  }
  return createFsIntegrationStore(projectId, getEnv("FS_STORE_ROOT"));
}

export function providerForConnection(
  connection: IntegrationConnectionRecord,
  options: { fetchImpl?: typeof fetch } = {},
): TaskProvider {
  const token = openSecret(
    { ciphertext: connection.encryptedToken, nonce: connection.tokenNonce },
    integrationSecret(),
    connectionAad(connection.projectId, connection.provider),
  );
  const common = {
    token,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  if (connection.provider === "asana") {
    // ASANA_API_BASE exists for a self-hosted stand-in in local development and
    // for the UI proof, which runs against the deterministic fake provider. A
    // deployment leaves it unset and talks to app.asana.com.
    const apiBase = getEnv("ASANA_API_BASE")?.trim();
    return createAsanaProvider({ ...common, ...(apiBase ? { apiBase } : {}) });
  }
  const endpoint = getEnv("LINEAR_GRAPHQL_ENDPOINT")?.trim();
  return createLinearProvider({ ...common, ...(endpoint ? { endpoint } : {}) });
}

export function oauthClient(provider: TaskProviderKind): { clientId: string; clientSecret: string } {
  const clientId = getEnv(provider === "asana" ? "ASANA_CLIENT_ID" : "LINEAR_CLIENT_ID")?.trim();
  const clientSecret = getEnv(provider === "asana" ? "ASANA_CLIENT_SECRET" : "LINEAR_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      `${provider === "asana" ? "ASANA" : "LINEAR"}_CLIENT_ID and ${provider === "asana" ? "ASANA" : "LINEAR"}_CLIENT_SECRET are not configured`,
    );
  }
  return { clientId, clientSecret };
}

export function newConnectionId(): string {
  return `conn-${randomUUID()}`;
}

export function newLinkId(): string {
  return `link-${randomUUID()}`;
}
