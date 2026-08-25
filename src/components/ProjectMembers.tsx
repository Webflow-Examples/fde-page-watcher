"use client";

import { useCallback, useEffect, useState } from "react";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useStore } from "./store";
import type { ProjectMembership, ProjectRole } from "@/lib/types";

export function ProjectMembers() {
  const { project, pathFor, user, flash } = useStore();
  const [members, setMembers] = useState<ProjectMembership[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("project_viewer");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(pathFor("/api/projects/members"), { cache: "no-store" });
      const body = await response.json().catch(() => null) as { members?: ProjectMembership[]; error?: string } | null;
      if (!response.ok || !body?.members) throw new Error(body?.error ?? "Could not load project access");
      setMembers(body.members);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not load project access");
    } finally {
      setLoading(false);
    }
  }, [flash, pathFor]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, project.id]);

  const save = async (nextEmail: string, nextRole: ProjectRole) => {
    setBusy(true);
    try {
      const response = await fetch(pathFor("/api/projects/members"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: nextEmail, role: nextRole }),
      });
      const body = await response.json().catch(() => null) as { members?: ProjectMembership[]; error?: string } | null;
      if (!response.ok || !body?.members) throw new Error(body?.error ?? "Could not update project access");
      setMembers(body.members);
      setEmail("");
      flash(`${nextEmail.toLowerCase()} can now access ${project.name}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not update project access");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: ProjectMembership) => {
    if (!window.confirm(`Remove ${member.email} from ${project.name}?`)) return;
    setBusy(true);
    try {
      const response = await fetch(pathFor("/api/projects/members"), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: member.email }),
      });
      const body = await response.json().catch(() => null) as { members?: ProjectMembership[]; error?: string } | null;
      if (!response.ok || !body?.members) throw new Error(body?.error ?? "Could not remove project access");
      setMembers(body.members);
      flash(`${member.email} removed from ${project.name}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not remove project access");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="project-access-heading" style={{ background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
      <div id="project-access-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>Project access</div>
      <div style={{ maxWidth: 720, marginTop: 4, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
        Invite project admins and viewers by email. Share the app link with them; Cloudflare Access sends their sign-in code.
      </div>
      <form
        onSubmit={(event) => { event.preventDefault(); if (email.trim()) void save(email.trim(), role); }}
        style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 180px auto", gap: 10, marginTop: 16 }}
      >
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" aria-label="Member email" style={{ background: "var(--surface-input)", color: "var(--text-body)", border: "1px solid var(--border-strong)", borderRadius: 7, padding: "9px 10px", fontSize: 13 }} />
        <select value={role} onChange={(event) => setRole(event.target.value as ProjectRole)} aria-label="Project role" style={{ background: "var(--surface-input)", color: "var(--text-body)", border: "1px solid var(--border-strong)", borderRadius: 7, padding: "9px 10px", fontSize: 12 }}>
          <option value="project_viewer">Project viewer</option>
          <option value="project_admin">Project admin</option>
        </select>
        <button type="submit" disabled={busy || !email.trim()} style={{ display: "flex", alignItems: "center", gap: 7, border: 0, borderRadius: 7, background: "var(--action-primary-bg)", color: "var(--action-primary-text)", padding: "9px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><PlusIcon size={14} /> Invite</button>
      </form>
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border-hairline)" }}>
        {loading ? <div style={{ padding: "14px 0", color: "var(--text-muted)", fontSize: 12 }}>Loading access…</div> : members.length === 0 ? (
          <div style={{ padding: "14px 0", color: "var(--text-muted)", fontSize: 12 }}>No explicit members yet. App admins still have full access.</div>
        ) : members.map((member) => (
          <div key={member.email} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 180px 34px", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid var(--border-hairline)" }}>
            <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis" }}>{member.email}</div><div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Invited by {member.invitedBy}</div></div>
            <select value={member.role} disabled={busy} onChange={(event) => void save(member.email, event.target.value as ProjectRole)} aria-label={`Role for ${member.email}`} style={{ background: "var(--surface-input)", color: "var(--text-body)", border: "1px solid var(--border-hairline)", borderRadius: 7, padding: "7px 9px", fontSize: 12 }}><option value="project_viewer">Project viewer</option><option value="project_admin">Project admin</option></select>
            {/*
              Destructive controls are bordered, never filled. The Phosphor icon
              takes its colour from the button through `currentColor`: Phosphor's
              `color` prop lands on the svg `fill` presentation attribute, where
              a var() would not resolve.
            */}
            <button type="button" aria-label={`Remove ${member.email}`} disabled={busy || member.email === user.email} onClick={() => void remove(member)} style={{ display: "grid", placeItems: "center", height: 30, border: "1px solid var(--action-destructive-border)", borderRadius: 7, background: "transparent", color: "var(--action-destructive-text)", cursor: "pointer" }}><TrashIcon size={14} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
