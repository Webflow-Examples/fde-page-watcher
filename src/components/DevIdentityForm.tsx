"use client";

import { useState } from "react";

export function DevIdentityForm({ email, endpoint = "/api/dev/session" }: { email: string; endpoint?: string }) {
  const [value, setValue] = useState(email);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: value }) });
        const body = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) {
          setError(body?.error ?? "Could not change the development identity");
          return;
        }
        window.location.reload();
      }}
      style={{ display: "grid", gap: 8, marginTop: 18 }}
    >
      <label htmlFor="empty-dev-user" style={{ color: "#a1a1aa", fontSize: 12 }}>Development user</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input id="empty-dev-user" type="email" required value={value} onChange={(event) => setValue(event.target.value)} style={{ minWidth: 0, flex: 1, border: "1px solid #303036", borderRadius: 7, background: "#0f0f11", color: "#f4f4f5", padding: "9px 10px" }} />
        <button type="submit" style={{ border: 0, borderRadius: 7, background: "#2356a8", color: "#fff", padding: "9px 13px", fontWeight: 600, cursor: "pointer" }}>Switch</button>
      </div>
      {error && <span role="alert" style={{ color: "#ff8b8b", fontSize: 11.5 }}>{error}</span>}
    </form>
  );
}
