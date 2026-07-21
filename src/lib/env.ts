import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Reads an env var from the Workers binding when running on Cloudflare,
 * falling back to process.env for local Node dev (`next dev`). Every call
 * site reads inside a request-scoped function, so getCloudflareContext() is
 * always safe to invoke here.
 */
export function getEnv(name: string): string | undefined {
  try {
    const value = (getCloudflareContext().env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string") return value;
  } catch {
    // Not running on Cloudflare Workers.
  }

  // Webflow's built-in routing values are framework environment variables,
  // not ordinary Worker bindings. Keep these property reads static so the
  // Next/OpenNext compiler preserves them in the server bundle. A computed
  // `process.env[name]` lookup does not reliably expose them in Webflow Cloud.
  if (name === "ASSETS_PREFIX") return process.env.ASSETS_PREFIX;
  if (name === "BASE_URL") return process.env.BASE_URL;

  return process.env[name];
}
