"use client";

import { useEffect, useState } from "react";
import { FolderSimpleIcon, PlusIcon, TrashIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useStore } from "@/components/store";
import type { Project } from "@/lib/projects";
import type { KnownWebflowIssueSummary } from "@/lib/knownWebflowIssues";
import type { UnmappedWebflowFindingSummary } from "@/lib/unmappedWebflowFindings";

export default function AdminPage() {
  const {
    adminProjects,
    projects,
    project,
    createProject,
    projectCreating,
    projectUpdating,
    renameProject,
    archiveProject,
    restoreProject,
    pathFor,
    flash,
  } = useStore();
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingCustomer, setEditingCustomer] = useState("");
  const [appAdmins, setAppAdmins] = useState<Array<{ email: string; bootstrap: boolean; invitedBy?: string }>>([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [knownIssues, setKnownIssues] = useState<KnownWebflowIssueSummary[]>([]);
  const [knownIssuesLoading, setKnownIssuesLoading] = useState(true);
  const [optimizeAffectedDetections, setOptimizeAffectedDetections] = useState(0);
  const [unmappedFindings, setUnmappedFindings] = useState<UnmappedWebflowFindingSummary[]>([]);
  const [unmappedFindingsLoading, setUnmappedFindingsLoading] = useState(true);
  const trimmedName = name.trim();
  const activeProjects = adminProjects.filter((item) => !item.archivedAt);
  const archivedProjects = adminProjects.filter((item) => !!item.archivedAt);
  const activeCount = projects.length;

  useEffect(() => {
    let cancelled = false;
    void fetch(pathFor("/api/admin/app-admins"), { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null) as { appAdmins?: typeof appAdmins; error?: string } | null;
      if (!response.ok || !body?.appAdmins) throw new Error(body?.error ?? "Could not load app administrators");
      if (!cancelled) setAppAdmins(body.appAdmins);
    }).catch((error) => { if (!cancelled) flash(error instanceof Error ? error.message : "Could not load app administrators"); });
    void fetch(pathFor("/api/admin/known-issues"), { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null) as {
        issues?: KnownWebflowIssueSummary[];
        optimizeAffectedDetections?: number;
        error?: string;
      } | null;
      if (!response.ok || !body?.issues) throw new Error(body?.error ?? "Could not load known issue signals");
      if (!cancelled) {
        setKnownIssues(body.issues);
        setOptimizeAffectedDetections(body.optimizeAffectedDetections ?? 0);
      }
    }).catch((error) => {
      if (!cancelled) flash(error instanceof Error ? error.message : "Could not load known issue signals");
    }).finally(() => { if (!cancelled) setKnownIssuesLoading(false); });
    void fetch(pathFor("/api/admin/unmapped-findings"), { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null) as {
        findings?: UnmappedWebflowFindingSummary[];
        error?: string;
      } | null;
      if (!response.ok || !body?.findings) throw new Error(body?.error ?? "Could not load unmapped audit signals");
      if (!cancelled) setUnmappedFindings(body.findings);
    }).catch((error) => {
      if (!cancelled) flash(error instanceof Error ? error.message : "Could not load unmapped audit signals");
    }).finally(() => { if (!cancelled) setUnmappedFindingsLoading(false); });
    return () => { cancelled = true; };
  }, [flash, pathFor]);

  const inviteAppAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adminEmail.trim() || adminBusy) return;
    setAdminBusy(true);
    try {
      const response = await fetch(pathFor("/api/admin/app-admins"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail }) });
      const body = await response.json().catch(() => null) as { appAdmins?: typeof appAdmins; error?: string } | null;
      if (!response.ok || !body?.appAdmins) throw new Error(body?.error ?? "Could not invite app administrator");
      setAppAdmins(body.appAdmins);
      flash(`${adminEmail.trim().toLowerCase()} is now an app administrator`);
      setAdminEmail("");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not invite app administrator");
    } finally {
      setAdminBusy(false);
    }
  };

  const removeAppAdmin = async (email: string) => {
    if (!window.confirm(`Remove app administrator access for ${email}?`)) return;
    setAdminBusy(true);
    try {
      const response = await fetch(pathFor("/api/admin/app-admins"), { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json().catch(() => null) as { appAdmins?: typeof appAdmins; error?: string } | null;
      if (!response.ok || !body?.appAdmins) throw new Error(body?.error ?? "Could not remove app administrator");
      setAppAdmins(body.appAdmins);
      flash(`${email} is no longer an app administrator`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not remove app administrator");
    } finally {
      setAdminBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedName || projectCreating) return;
    const created = await createProject(trimmedName, customer.trim());
    if (created) {
      setName("");
      setCustomer("");
    }
  };

  const beginEdit = (item: Project) => {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditingCustomer(item.customer ?? "");
  };

  const saveProject = async (id: string) => {
    const nextName = editingName.trim();
    if (!nextName || projectUpdating) return;
    if (await renameProject(id, nextName, editingCustomer.trim())) setEditingId(null);
  };

  const renderProjectRows = (items: Project[], emptyMessage: string) => (
    <div className="admin-project-list">
      {items.length === 0 ? <div className="admin-project-list__empty">{emptyMessage}</div> : items.map((item) => {
        const current = item.id === project.id;
        const archived = !!item.archivedAt;
        const editing = editingId === item.id;
        return (
          <div className={`admin-project-row${archived ? " admin-project-row--archived" : ""}`} key={item.id}>
            <span className="admin-project-row__icon" aria-hidden="true">
              <FolderSimpleIcon size={18} weight="fill" />
            </span>
            <div className="admin-project-row__name">
              {editing ? (
                <div className="admin-project-row__fields">
                  <input
                    aria-label={`Project name for ${item.name}`}
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveProject(item.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    maxLength={120}
                    autoFocus
                  />
                  <input
                    aria-label={`Customer for ${item.name}`}
                    value={editingCustomer}
                    onChange={(event) => setEditingCustomer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveProject(item.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    maxLength={120}
                    placeholder="Customer"
                  />
                </div>
              ) : <strong>{item.name}</strong>}
              <span>
                {item.customer ? `Customer: ${item.customer}` : "Customer not set"}
                {` · ${archived ? "All pages paused" : current ? "Currently viewing" : "Available to switch"}`}
              </span>
            </div>
            <div className="admin-project-row__actions">
              {editing ? (
                <>
                  <button type="button" onClick={() => void saveProject(item.id)} disabled={!editingName.trim() || projectUpdating}>Save</button>
                  <button type="button" onClick={() => setEditingId(null)} disabled={projectUpdating}>Cancel</button>
                </>
              ) : (
                <>
                  <span className={`admin-project-row__status${current ? " admin-project-row__status--current" : ""}${archived ? " admin-project-row__status--archived" : ""}`}>
                    {archived ? "Archived" : current ? "Current" : "Active"}
                  </span>
                  <button type="button" onClick={() => beginEdit(item)} disabled={projectUpdating}>Edit</button>
                  {archived ? (
                    <button type="button" onClick={() => void restoreProject(item.id)} disabled={projectUpdating}>Restore</button>
                  ) : (
                    <button
                      type="button"
                      className="admin-project-row__archive"
                      onClick={() => {
                        if (window.confirm(`Archive ${item.name}? Its pages will be paused and its history retained.`)) {
                          void archiveProject(item.id);
                        }
                      }}
                      disabled={projectUpdating || activeCount <= 1}
                      title={activeCount <= 1 ? "At least one project must remain active" : undefined}
                    >Archive</button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <div>
          <div className="admin-page__eyebrow">Administration</div>
          <h1>Projects</h1>
          <p>Manage project ownership, archive inactive work, or create a new empty project.</p>
        </div>
        <div className="admin-page__count" aria-label={`${activeCount} active projects, ${adminProjects.length} total`}>
          <strong>{activeCount}</strong>
          <span>active · {adminProjects.length} total</span>
        </div>
      </header>

      <div className="admin-page__grid">
        <div className="admin-project-groups">
          <section className="admin-card" aria-labelledby="active-projects-heading">
            <div className="admin-card__heading">
              <div>
                <h2 id="active-projects-heading">Active projects</h2>
                <p>Projects available in the workspace and project switcher.</p>
              </div>
              <span className="admin-card__heading-count">{activeProjects.length}</span>
            </div>
            {renderProjectRows(activeProjects, "No active projects.")}
          </section>

          <section className="admin-card admin-card--archived" aria-labelledby="archived-projects-heading">
            <div className="admin-card__heading">
              <div>
                <h2 id="archived-projects-heading">Archived projects</h2>
                <p>History is retained and every page remains paused until restoration.</p>
              </div>
              <span className="admin-card__heading-count">{archivedProjects.length}</span>
            </div>
            {renderProjectRows(archivedProjects, "No archived projects.")}
          </section>
        </div>

        <div className="admin-page__sidebar">
        <section className="admin-card admin-card--create" aria-labelledby="create-project-heading">
          <div className="admin-card__create-heading">
            <span className="admin-card__create-icon" aria-hidden="true"><PlusIcon size={18} weight="bold" /></span>
            <h2 id="create-project-heading">Create a project</h2>
          </div>
          <form onSubmit={submit}>
            <label htmlFor="new-project-name">Project name</label>
            <input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="e.g. Marketing site"
              autoComplete="off"
            />
            <label htmlFor="new-project-customer">Customer</label>
            <input
              id="new-project-customer"
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              maxLength={120}
              placeholder="e.g. Acme Inc."
              autoComplete="organization"
            />
            <button type="submit" disabled={!trimmedName || projectCreating}>
              <PlusIcon size={15} weight="bold" />
              {projectCreating ? "Creating…" : "Create project"}
            </button>
          </form>
        </section>

        <section className="admin-card admin-card--app-admins" aria-labelledby="app-admins-heading">
        <div className="admin-card__heading">
          <div>
            <h2 id="app-admins-heading">App administrators</h2>
            <p>App admins can access every project and all workspace settings. New admins must use a @webflow.com email.</p>
          </div>
          <span className="admin-card__heading-count">{appAdmins.length}</span>
        </div>
        <form className="admin-app-admin-form" onSubmit={inviteAppAdmin}>
          <input type="email" required value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="name@webflow.com" aria-label="New app administrator email" />
          <button type="submit" disabled={adminBusy || !adminEmail.trim()}><PlusIcon size={14} weight="bold" /> Invite app admin</button>
        </form>
        <div className="admin-project-list">
          {appAdmins.map((admin) => (
            <div className="admin-project-row" key={admin.email}>
              <span className="admin-project-row__icon" aria-hidden="true"><UserCircleIcon size={19} weight="fill" /></span>
              <div className="admin-project-row__name"><strong>{admin.email}</strong><span>{admin.bootstrap ? "Permanent admin" : `Invited by ${admin.invitedBy ?? "an app administrator"}`}</span></div>
              <div className="admin-project-row__actions">
                <span className="admin-project-row__status admin-project-row__status--current">App admin</span>
                {!admin.bootstrap && <button type="button" aria-label={`Remove ${admin.email}`} onClick={() => void removeAppAdmin(admin.email)} disabled={adminBusy}><TrashIcon size={14} /> Remove</button>}
              </div>
            </div>
          ))}
        </div>
        </section>
        </div>
      </div>
      <section className="admin-card" aria-labelledby="known-webflow-issues-heading" style={{ marginTop: 18 }}>
        <div className="admin-card__heading">
          <div>
            <h2 id="known-webflow-issues-heading">Known Webflow issue signals</h2>
            <p>
              High-confidence Webflow-generated pages with platform-attributed evidence from the last 30 days.
              {optimizeAffectedDetections > 0 ? ` ${optimizeAffectedDetections} detections occurred while Webflow Optimize variation signals were present.` : ""}
            </p>
          </div>
          <span className="admin-card__heading-count">{knownIssues.length}</span>
        </div>
        {knownIssuesLoading ? (
          <div className="admin-project-list__empty">Loading issue signals…</div>
        ) : knownIssues.length === 0 ? (
          <div className="admin-project-list__empty">No confidently attributed Webflow issue signals were detected in this window.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "9px 10px" }}>Issue</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Customers</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Pages</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Detections</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {knownIssues.map((issue) => (
                  <tr key={issue.key} style={{ borderTop: "1px solid var(--border-hairline)" }}>
                    <td style={{ padding: "11px 10px" }}><strong>{issue.title}</strong><div style={{ color: "var(--text-muted)", marginTop: 2 }}>{issue.key}</div></td>
                    <td style={{ padding: "11px 10px", textAlign: "right" }}>{issue.customerCount}</td>
                    <td style={{ padding: "11px 10px", textAlign: "right" }}>{issue.pageCount}</td>
                    <td style={{ padding: "11px 10px", textAlign: "right" }}>{issue.detections}</td>
                    <td style={{ padding: "11px 10px", textAlign: "right", whiteSpace: "nowrap" }}>{new Date(issue.lastSeen).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="admin-card" aria-labelledby="unmapped-findings-heading" style={{ marginTop: 18 }}>
        <div className="admin-card__heading">
          <div>
            <h2 id="unmapped-findings-heading">Unmapped Lighthouse audits</h2>
            <p>
              Audit IDs seen in collection evidence from the last 30 days that aren&rsquo;t in the Webflow remediation
              catalog yet. These still surface to customers as &ldquo;Needs review&rdquo; rather than being hidden —
              add them to <code>CATALOG</code> in <code>webflowPerformance.ts</code> once triaged.
            </p>
          </div>
          <span className="admin-card__heading-count">{unmappedFindings.length}</span>
        </div>
        {unmappedFindingsLoading ? (
          <div className="admin-project-list__empty">Loading unmapped audit signals…</div>
        ) : unmappedFindings.length === 0 ? (
          <div className="admin-project-list__empty">No unmapped Lighthouse audit IDs were detected in this window.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "9px 10px" }}>Audit ID</th>
                  <th style={{ padding: "9px 10px" }}>Category</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Customers</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Pages</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Detections</th>
                  <th style={{ padding: "9px 10px", textAlign: "right" }}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {unmappedFindings.map((finding) => (
                  <tr key={finding.key} style={{ borderTop: "1px solid var(--border-hairline)" }}>
                    <td style={{ padding: "11px 10px" }}><strong>{finding.key}</strong><div style={{ color: "var(--text-muted)", marginTop: 2 }}>{finding.title}</div></td>
                    <td style={{ padding: "11px 10px" }}>{finding.category}</td>
                    <td style={{ padding: "11px 10px", textAlign: "right" }}>{finding.customerCount}</td>
                    <td style={{ padding: "11px 10px", textAlign: "right" }}>{finding.pageCount}</td>
                    <td style={{ padding: "11px 10px", textAlign: "right" }}>{finding.detections}</td>
                    <td style={{ padding: "11px 10px", textAlign: "right", whiteSpace: "nowrap" }}>{new Date(finding.lastSeen).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
