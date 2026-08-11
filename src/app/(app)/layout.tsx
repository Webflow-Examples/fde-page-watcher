import { StoreProvider } from "@/components/store";
import { Sidebar } from "@/components/Sidebar";
import { ChromeOverlays } from "@/components/overlays";
import { getEnv } from "@/lib/env";
import { normalizeBasePath } from "@/lib/paths";
import { availableProjects, defaultConfiguredProject } from "@/lib/projects";
import { getStore } from "@/lib/store";

// The store reads/writes the local filesystem; force Node.js so that's
// actually available (some hosts default unannotated segments to an
// edge/Workers runtime without it).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const project = defaultConfiguredProject();
  const projects = await availableProjects();
  const dataStore = getStore(project.tenant);
  const [state, visitorExperience] = await Promise.all([
    dataStore.getState(),
    dataStore.getCruxEvidence().catch(() => []),
  ]);
  const basePath = normalizeBasePath(getEnv("BASE_URL"));
  return (
    <StoreProvider
      initial={state}
      initialVisitorExperience={visitorExperience}
      basePath={basePath}
      projects={projects}
      initialProjectId={project.id}
    >
      <div className="app-shell" style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <main className="app-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</main>
      </div>
      <ChromeOverlays />
    </StoreProvider>
  );
}
