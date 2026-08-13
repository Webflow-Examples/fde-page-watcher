"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "./store";
import { C } from "@/lib/ui";
import { normalizeCollectionSchedule } from "@/lib/collectionSchedule";
import { ClockIcon, DashboardIcon, EyeIcon, InboxIcon, PagesIcon, TasksIcon } from "./icons";
import { GearIcon, ShieldCheckIcon, SignOutIcon } from "@phosphor-icons/react";
import { isFieldRecommendationActionable } from "@/lib/fieldOnlyRecommendations";
import { SelectMenu } from "./select-menu";
import webflowSocialLogo from "../../public/webflow-social.png";
import { useState } from "react";

const primaryNavItems = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon, badge: null as "inbox" | "tasks" | "watchlist" | null },
  { href: "/pages", label: "Pages", Icon: PagesIcon, badge: null },
];

const activityNavItems = [
  { href: "/inbox", label: "Inbox", Icon: InboxIcon, badge: "inbox" as const },
  { href: "/tasks", label: "Tasks", Icon: TasksIcon, badge: "tasks" as const },
];

const managementNavItems = [
  { href: "/watchlist", label: "Watchlist", Icon: EyeIcon, badge: "watchlist" as const },
  { href: "/settings", label: "Settings", Icon: GearIcon, badge: null },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    pages,
    recs,
    pathFor,
    collectionSchedule,
    projects,
    project,
    projectSwitching,
    switchProject,
    user,
    canManageProject,
  } = useStore();
  const [devEmail, setDevEmail] = useState(user.email);
  const inboxCount = recs.filter((r) => r.status === "inbox" && isFieldRecommendationActionable(r)).length;
  const taskCount = recs.filter((r) => r.status === "task").length;
  const watchlistCount = pages.length;

  const schedule = normalizeCollectionSchedule(collectionSchedule);
  const navGroups = canManageProject
    ? [primaryNavItems, activityNavItems, managementNavItems]
    : [primaryNavItems, activityNavItems];

  return (
    <aside
      className="app-sidebar"
      style={{
        width: 244,
        flex: "none",
        background: C.bgElev,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <div className="sidebar-brand">
        <div className="sidebar-brand__identity">
          <Image
            src={webflowSocialLogo}
            alt="Webflow"
            width={30}
            height={30}
            priority
            unoptimized
            style={{ borderRadius: 7 }}
          />
          <div className="sidebar-brand__product-name">Page Watch</div>
        </div>
        <SelectMenu
          className="sidebar-project-menu"
          ariaLabel="Switch project"
          value={project.id}
          options={projects.map((item) => ({ value: item.id, label: item.name }))}
          triggerDescription={project.customer || "Customer not set"}
          disabled={projects.length < 2}
          loading={projectSwitching}
          triggerWidth="100%"
          menuWidth={200}
          onChange={async (nextProjectId) => {
            const switched = await switchProject(nextProjectId);
            if (!switched) throw new Error("Project switch failed");
            router.push(pathFor("/dashboard"));
          }}
        />
      </div>

      <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 12px" }}>
        {navGroups.map((group, groupIndex) => <div key={groupIndex} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {groupIndex > 0 && <hr style={{ width: "100%", margin: "7px 0", border: 0, borderTop: `1px solid ${C.border}` }} />}
        {group.map(({ href, label, Icon, badge }) => {
          const resolvedHref = pathFor(href);
          const active = pathname === resolvedHref
            || (href === "/dashboard" && pathname === pathFor("/"))
            || (href === "/pages" && pathname.startsWith(`${resolvedHref}/`));
          const count = badge === "inbox" ? inboxCount : badge === "tasks" ? taskCount : badge === "watchlist" ? watchlistCount : 0;
          return (
            <Link
              key={href}
              href={resolvedHref}
              className="sidebar-link"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 12px",
                borderRadius: 7,
                fontSize: 13.5,
                fontWeight: 500,
                textDecoration: "none",
                color: active ? "#FFFFFF" : C.faint2,
                background: active ? "rgba(255,255,255,0.07)" : "transparent",
              }}
            >
              <Icon size={17} />
              <span className="sidebar-link-label">{label}</span>
              {badge && count > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    fontWeight: 600,
                    color: badge === "inbox" ? C.accentSoft : badge === "tasks" ? C.green : "inherit",
                    background: badge === "inbox"
                      ? "rgba(59,137,255,0.16)"
                      : badge === "tasks"
                        ? "rgba(53,208,127,0.16)"
                        : "transparent",
                    padding: "1px 8px",
                    borderRadius: 20,
                  }}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
        </div>)}
        <hr style={{ width: "100%", margin: "7px 0 0", border: 0, borderTop: `1px solid ${C.border}` }} />
      </nav>

      <div className="sidebar-schedule" style={{ marginTop: 8, padding: "12px 20px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 550, letterSpacing: "0.06em", color: C.faint, textTransform: "uppercase", marginBottom: 10 }}>
          Next nightly run
        </div>
        <div style={{ border: `1px solid ${C.border}`, background: C.panel, borderRadius: 9, padding: "13px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, fontWeight: 500 }}>
            <ClockIcon size={15} style={{ color: C.accentBright }} />
            Daily · {schedule.localTime} {schedule.timeZone}
          </div>
        </div>
      </div>
      <div className="sidebar-admin" style={{ marginTop: "auto", padding: "0 12px 18px" }}>
        {user.isAppAdmin && <Link
          href={pathFor("/admin")}
          className="sidebar-admin-link"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 10px",
            borderRadius: 7,
            color: pathname === pathFor("/admin") ? C.text : C.muted,
            background: pathname === pathFor("/admin") ? "rgba(255,255,255,0.07)" : "transparent",
            textDecoration: "none",
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          <ShieldCheckIcon size={16} />
          <span>Admin</span>
        </Link>
        }
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, padding: "12px 10px 0", fontSize: 11.5, color: C.muted }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
          <div style={{ marginTop: 3, color: C.faint }}>{user.isAppAdmin ? "App admin" : project.accessRole === "project_admin" ? "Project admin" : "Project viewer"}</div>
          {user.development && (
            <form
              style={{ display: "flex", gap: 6, marginTop: 10 }}
              onSubmit={async (event) => {
                event.preventDefault();
                const response = await fetch(pathFor("/api/dev/session"), {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email: devEmail }),
                });
                if (response.ok) window.location.reload();
              }}
            >
              <input
                aria-label="Development user email"
                type="email"
                value={devEmail}
                onChange={(event) => setDevEmail(event.target.value)}
                style={{ minWidth: 0, width: "100%", border: `1px solid ${C.border}`, borderRadius: 6, background: C.panel, color: C.text, padding: "6px 7px", fontSize: 10.5 }}
              />
              <button type="submit" style={{ border: `1px solid ${C.border}`, borderRadius: 6, background: C.panel2, color: C.text, padding: "0 8px", cursor: "pointer" }}>Use</button>
            </form>
          )}
          {!user.development && (
            <button
              type="button"
              className="sidebar-sign-out"
              onClick={async () => {
                const response = await fetch(pathFor("/api/auth/logout"), { method: "POST" });
                const body = await response.json().catch(() => ({})) as { redirectTo?: string };
                window.location.assign(pathFor(body.redirectTo ?? "/login"));
              }}
            >
              <SignOutIcon size={14} />
              Sign out
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
