import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessForIdentity } from "@/lib/authorization";
import { identityFromHeaders } from "@/lib/identity";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const identity = await identityFromHeaders(new Headers(await headers()));
  const access = await accessForIdentity(identity);
  if (!access.isAppAdmin) redirect("/dashboard");
  return children;
}
