import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessForIdentity } from "@/lib/authorization";
import { identityFromHeaders } from "@/lib/identity";
import { defaultAccessibleProject } from "@/lib/projects";

export async function requireProjectAdminPage() {
  const identity = await identityFromHeaders(new Headers(await headers()));
  const access = await accessForIdentity(identity);
  const project = await defaultAccessibleProject(access);
  if (!project || (!access.isAppAdmin && access.projectRoles[project.id] !== "project_admin")) {
    redirect("/dashboard");
  }
}
