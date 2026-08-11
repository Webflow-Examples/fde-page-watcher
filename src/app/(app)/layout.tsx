import { StoreProvider } from "@/components/store";
import { Sidebar } from "@/components/Sidebar";
import { ChromeOverlays } from "@/components/overlays";
import { getEnv } from "@/lib/env";
import { normalizeBasePath } from "@/lib/paths";
import { adminProjects } from "@/lib/projects";
import { getStore } from "@/lib/store";
import { headers } from "next/headers";
import { identityFromHeaders } from "@/lib/identity";
import { accessForIdentity } from "@/lib/authorization";
import { accessibleProjects, defaultAccessibleProject } from "@/lib/projects";
import { DevIdentityForm } from "@/components/DevIdentityForm";
import { withBasePath } from "@/lib/paths";

// The store reads/writes the local filesystem; force Node.js so that's
// actually available (some hosts default unannotated segments to an
// edge/Workers runtime without it).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const identity = await identityFromHeaders(new Headers(await headers()));
  const access = await accessForIdentity(identity);
  const basePath = normalizeBasePath(getEnv("BASE_URL"));
  const project = await defaultAccessibleProject(access);
  if (!project) {
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
  const [projects, allProjects] = await Promise.all([
    accessibleProjects(access),
    access.isAppAdmin ? adminProjects() : Promise.resolve([]),
  ]);
  const dataStore = getStore(project.tenant);
  const [state, visitorExperience] = await Promise.all([
    dataStore.getState(),
    dataStore.getCruxEvidence().catch(() => []),
  ]);
  return (
    <StoreProvider
      initial={state}
      initialVisitorExperience={visitorExperience}
      basePath={basePath}
      projects={projects}
      adminProjects={allProjects}
      initialProjectId={project.id}
      user={{ email: identity.email, isAppAdmin: access.isAppAdmin, development: identity.source === "development" }}
    >
      <div className="app-shell" style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <main className="app-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</main>
      </div>
      <ChromeOverlays />
    </StoreProvider>
  );
}
