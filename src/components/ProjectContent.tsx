"use client";

import { useStore } from "./store";

export function ProjectContent({ children }: { children: React.ReactNode }) {
  const { projectSwitching } = useStore();

  return (
    <main className="app-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {projectSwitching ? (
        <div
          aria-busy="true"
          style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-muted)", fontSize: 13 }}
        >
          Loading project…
        </div>
      ) : children}
    </main>
  );
}
