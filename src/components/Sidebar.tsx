"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useStore } from "./store";
import { C } from "@/lib/ui";
import { normalizeCollectionSchedule } from "@/lib/collectionSchedule";
import { ClockIcon, DashboardIcon, EyeIcon, InboxIcon, PagesIcon, TasksIcon } from "./icons";
import { GearIcon, MegaphoneIcon } from "@phosphor-icons/react";
import { isFieldRecommendationActionable } from "@/lib/fieldOnlyRecommendations";
import webflowSocialLogo from "../../public/webflow-social.png";

const navItems = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon, badge: null as "inbox" | "tasks" | "escalations" | "watchlist" | null },
  { href: "/pages", label: "Pages", Icon: PagesIcon, badge: null },
  { href: "/inbox", label: "Inbox", Icon: InboxIcon, badge: "inbox" as const },
  { href: "/tasks", label: "Tasks", Icon: TasksIcon, badge: "tasks" as const },
  { href: "/escalations", label: "Escalations", Icon: MegaphoneIcon, badge: "escalations" as const },
  { href: "/watchlist", label: "Watchlist", Icon: EyeIcon, badge: "watchlist" as const },
  { href: "/settings", label: "Settings", Icon: GearIcon, badge: null },
];

export function Sidebar() {
  const pathname = usePathname();
  const { pages, recs, productEscalations, pathFor, collectionSchedule } = useStore();
  const inboxCount = recs.filter((r) => r.status === "inbox" && isFieldRecommendationActionable(r)).length;
  const taskCount = recs.filter((r) => r.status === "task").length;
  const watchlistCount = pages.length;
  const escalationCount = (productEscalations ?? []).filter((item) => item.status !== "resolved").length;

  const schedule = normalizeCollectionSchedule(collectionSchedule);

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
        <Image
          src={webflowSocialLogo}
          alt="Webflow"
          width={30}
          height={30}
          priority
          unoptimized
          style={{ borderRadius: 7 }}
        />
        <div className="sidebar-brand-text" style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Page Watch</div>
          <div style={{ fontSize: 11, color: C.muted }}>Brand Studio</div>
        </div>
      </div>

      <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 12px" }}>
        {navItems.map(({ href, label, Icon, badge }) => {
          const resolvedHref = pathFor(href);
          const active = pathname === resolvedHref
            || (href === "/dashboard" && pathname === pathFor("/"))
            || (href === "/pages" && pathname.startsWith(`${resolvedHref}/`));
          const count = badge === "inbox" ? inboxCount : badge === "tasks" ? taskCount : badge === "escalations" ? escalationCount : badge === "watchlist" ? watchlistCount : 0;
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
                    color: badge === "inbox" ? C.accentSoft : badge === "tasks" ? C.green : badge === "escalations" ? C.amber : "inherit",
                    background: badge === "inbox"
                      ? "rgba(59,137,255,0.16)"
                      : badge === "tasks"
                        ? "rgba(53,208,127,0.16)"
                        : badge === "escalations"
                          ? "rgba(255,154,61,0.16)"
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
      </nav>

      <div className="sidebar-schedule" style={{ marginTop: "auto", padding: "26px 20px 22px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 550, letterSpacing: "0.06em", color: C.faint, textTransform: "uppercase", marginBottom: 10 }}>
          Next nightly run
        </div>
        <div style={{ border: `1px solid ${C.border}`, background: C.panel, borderRadius: 9, padding: "13px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, fontWeight: 500 }}>
            <ClockIcon size={15} style={{ color: C.accentBright }} />
            Daily · {schedule.localTime} {schedule.timeZone}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Up to 5 independent runs per strategy via PSI, plus one agent-readiness scan.
          </div>
        </div>
      </div>
    </aside>
  );
}
