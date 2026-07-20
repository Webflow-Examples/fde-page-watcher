"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "./store";
import { C } from "@/lib/ui";
import { formatNextRunLocal } from "@/lib/schedule";
import { ClockIcon, DashboardIcon, EyeIcon, InboxIcon, LogoMark, TasksIcon } from "./icons";

// The next-run label depends on the viewer's local timezone, so it's read via
// useSyncExternalStore: the server snapshot is a UTC fallback and the client
// snapshot is the localized time — matching on hydration, no setState-in-effect.
const noopSubscribe = () => () => {};
const serverRunLabel = () => "Tonight · 3:00 AM UTC";

const navItems = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon, badge: null as "inbox" | "tasks" | null },
  { href: "/inbox", label: "Inbox", Icon: InboxIcon, badge: "inbox" as const },
  { href: "/tasks", label: "Tasks", Icon: TasksIcon, badge: "tasks" as const },
  { href: "/watchlist", label: "Watchlist", Icon: EyeIcon, badge: null },
];

export function Sidebar() {
  const pathname = usePathname();
  const { recs } = useStore();
  const inboxCount = recs.filter((r) => r.status === "inbox").length;
  const taskCount = recs.filter((r) => r.status === "task").length;

  // Next run in the viewer's local timezone (UTC fallback during SSR/hydration).
  const runLabel = useSyncExternalStore(noopSubscribe, formatNextRunLocal, serverRunLabel);

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
      <div className="sidebar-brand" style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px 22px 20px" }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LogoMark size={17} style={{ color: "#fff" }} />
        </div>
        <div className="sidebar-brand-text" style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Page Watch</div>
          <div style={{ fontSize: 11, color: C.muted }}>Brand Studio</div>
        </div>
      </div>

      <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 12px" }}>
        {navItems.map(({ href, label, Icon, badge }) => {
          const active = pathname === href || (href === "/dashboard" && pathname === "/");
          const count = badge === "inbox" ? inboxCount : badge === "tasks" ? taskCount : 0;
          return (
            <Link
              key={href}
              href={href}
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
                    color: badge === "inbox" ? C.accentSoft : C.dim,
                    background: badge === "inbox" ? "rgba(59,137,255,0.16)" : "rgba(255,255,255,0.08)",
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
      </nav>

      <div className="sidebar-schedule" style={{ marginTop: 26, padding: "0 20px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 550, letterSpacing: "0.06em", color: C.faint, textTransform: "uppercase", marginBottom: 10 }}>
          Next nightly run
        </div>
        <div style={{ border: `1px solid ${C.border}`, background: C.panel, borderRadius: 9, padding: "13px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, fontWeight: 500 }}>
            <ClockIcon size={15} style={{ color: C.accentBright }} />
            {runLabel}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            5 runs per page per strategy via PSI, plus one agent-readiness scan.
          </div>
        </div>
      </div>
    </aside>
  );
}
