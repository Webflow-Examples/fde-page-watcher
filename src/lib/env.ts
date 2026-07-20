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
  return process.env[name];
}
