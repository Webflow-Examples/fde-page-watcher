import { getStore } from "@/lib/store";
import { StoreProvider } from "@/components/store";
import { Sidebar } from "@/components/Sidebar";
import { ChromeOverlays } from "@/components/overlays";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const state = await getStore().getState();
  return (
    <StoreProvider initial={state}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</main>
      </div>
      <ChromeOverlays />
    </StoreProvider>
  );
}
