import { getStore } from "@/lib/store";
import { StoreProvider } from "@/components/store";
import { Sidebar } from "@/components/Sidebar";
import { ChromeOverlays } from "@/components/overlays";

// The store reads/writes the local filesystem; force Node.js so that's
// actually available (some hosts default unannotated segments to an
// edge/Workers runtime without it).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const state = await getStore().getState();
  return (
    <StoreProvider initial={state}>
      <div className="app-shell" style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <main className="app-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</main>
      </div>
      <ChromeOverlays />
    </StoreProvider>
  );
}
