"use client";

import { useEffect, useRef, useState } from "react";
import { LAST_PROJECT_KEY } from "@/lib/projectSelection";

export function ProjectSelectionBootstrap({
  endpoint,
  projectIds,
  fallbackProjectId,
}: {
  endpoint: string;
  projectIds: string[];
  fallbackProjectId: string;
}) {
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(LAST_PROJECT_KEY);
    } catch {
      // Browser storage can be disabled; the server-approved fallback is safe.
    }
    const projectId = saved && projectIds.includes(saved) ? saved : fallbackProjectId;
    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      try {
        window.localStorage.setItem(LAST_PROJECT_KEY, projectId);
      } catch {
        // The server cookie is authoritative; local storage is only migration support.
      }
      window.location.reload();
    }).catch(() => setFailed(true));
  }, [endpoint, fallbackProjectId, projectIds]);

  return (
    <main
      aria-busy={!failed}
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--surface-page)", color: "var(--text-body)", padding: 24 }}
    >
      <section style={{ textAlign: "center" }}>
        <div style={{ color: "var(--action-primary-ink)", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Page Watch</div>
        {/*
          A failed project fetch is a request error, not a page-health verdict,
          so it reads through --status-danger-text and never --health-poor-text.
        */}
        <p style={{ color: failed ? "var(--status-danger-text)" : "var(--text-muted)", margin: "12px 0 0" }}>
          {failed ? "Couldn't load your project. Refresh to try again." : "Loading your project…"}
        </p>
      </section>
    </main>
  );
}
