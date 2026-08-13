import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { AuthenticationError, identityFromHeaders } from "@/lib/identity";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; signedOut?: string }> }) {
  let authenticated = false;
  try {
    await identityFromHeaders(new Headers(await headers()));
    authenticated = true;
  } catch (error) {
    if (!(error instanceof AuthenticationError)) throw error;
  }
  if (authenticated) redirect("/dashboard");
  const basePath = normalizeBasePath(getEnv("BASE_URL"));
  const { error, signedOut } = await searchParams;
  return <LoginForm startHref={withBasePath(basePath, "/api/auth/start")} error={error} signedOut={signedOut === "1"} />;
}
