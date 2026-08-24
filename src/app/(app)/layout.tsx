import { StoreProvider } from "@/components/store";
import { Sidebar } from "@/components/Sidebar";
import { ChromeOverlays } from "@/components/overlays";
import { getEnv } from "@/lib/env";
import { normalizeBasePath } from "@/lib/paths";
import { adminProjects } from "@/lib/projects";
import { getStore } from "@/lib/store";
import { headers } from "next/headers";
import { identityFromHeaders } from "@/lib/identity";
import { AuthenticationError } from "@/lib/identity";
import { accessForIdentity } from "@/lib/authorization";
import { accessibleProjects, defaultAccessibleProject } from "@/lib/projects";
import { DevIdentityForm } from "@/components/DevIdentityForm";
import { withBasePath } from "@/lib/paths";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PROJECT_SELECTION_COOKIE } from "@/lib/projectSelection";
import { ProjectSelectionBootstrap } from "@/components/ProjectSelectionBootstrap";
import { ProjectContent } from "@/components/ProjectContent";

// The store reads/writes the local filesystem; force Node.js so that's
// actually available (some hosts default unannotated segments to an
// edge/Workers runtime without it).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const basePath = normalizeBasePath(getEnv("BASE_URL"));
  let identity;
  try {
    identity = await identityFromHeaders(new Headers(await headers()));
  } catch (error) {
    if (error instanceof AuthenticationError) redirect(withBasePath(basePath, "/login"));
    throw error;
  }
  const access = await accessForIdentity(identity);
  const [projects, allProjects] = await Promise.all([
    accessibleProjects(access),
    access.isAppAdmin ? adminProjects() : Promise.resolve([]),
  ]);
  if (projects.length === 0) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0b0c", color: "#f4f4f5", padding: 24 }}>
        <section style={{ width: "min(520px, 100%)", border: "1px solid #28282c", borderRadius: 14, background: "#141416", padding: 28 }}>
          <div style={{ color: "#68a6ff", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Page Watch</div>
          <h1 style={{ margin: "12px 0 8px", fontSize: 26 }}>No project access yet</h1>
          <p style={{ color: "#a1a1aa", lineHeight: 1.6, margin: 0 }}>
            You’re signed in as {identity.email}, but this email has not been invited to a project. Ask a project administrator to add you, then refresh this page.
          </p>
          {identity.source === "development" && <DevIdentityForm email={identity.email} endpoint={withBasePath(basePath, "/api/dev/session")} />}
        </section>
      </main>
    );
  }
  const rememberedProjectId = (await cookies()).get(PROJECT_SELECTION_COOKIE)?.value;
  const rememberedProjectIsAccessible = !!rememberedProjectId && projects.some(({ id }) => id === rememberedProjectId);
  if (projects.length > 1 && !rememberedProjectIsAccessible) {
    return (
      <ProjectSelectionBootstrap
        endpoint={withBasePath(basePath, "/api/projects/selection")}
        projectIds={projects.map(({ id }) => id)}
        fallbackProjectId={projects[0].id}
      />
    );
  }
  const project = await defaultAccessibleProject(access, rememberedProjectId ?? projects[0].id);
  if (!project || (rememberedProjectIsAccessible && project.id !== rememberedProjectId)) {
    return (
      <ProjectSelectionBootstrap
        endpoint={withBasePath(basePath, "/api/projects/selection")}
        projectIds={projects.map(({ id }) => id)}
        fallbackProjectId={projects[0].id}
      />
    );
  }
  const dataStore = getStore(project.tenant);
  const [state, visitorExperience, externalAgentAudits] = await Promise.all([
    dataStore.getState(),
    dataStore.getCruxEvidence().catch(() => []),
    dataStore.getExternalAgentAudits().catch(() => []),
  ]);
  return (
    <StoreProvider
      initial={state}
      initialVisitorExperience={visitorExperience}
      initialExternalAgentAudits={externalAgentAudits}
      basePath={basePath}
      projects={projects}
      adminProjects={allProjects}
      initialProjectId={project.id}
      user={{ email: identity.email, isAppAdmin: access.isAppAdmin, development: identity.source === "development" }}
    >
      <div className="app-shell" style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <ProjectContent>{children}</ProjectContent>
      </div>
      <ChromeOverlays />
    </StoreProvider>
  );
}
