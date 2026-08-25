"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "./store";
import { MAGNITUDE_WEIGHT } from "./magnitude";
import { normalizeCollectionSchedule } from "@/lib/collectionSchedule";
import { ClockIcon, EyeIcon, PagesIcon } from "./icons";
import { GearIcon, ShieldCheckIcon, SignOutIcon, WarningDiamondIcon } from "@phosphor-icons/react";
import { decideQueueCount } from "@/lib/decideQueue";
import { DESTINATION_LABEL, DESTINATION_PATH, QUEUE_LABEL } from "@/lib/vocabulary";
import type { Destination } from "@/lib/vocabulary";
import { SelectMenu } from "./select-menu";
import webflowSocialLogo from "../../public/webflow-social.png";
import type { ComponentType } from "react";
import { useState } from "react";
import { clearPageWatchBrowserState } from "@/lib/clientLogout";
import { AppearanceControl } from "./appearance";

const ACCESS_LOGOUT_STEP_MS = 1_500;

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

interface NavItem {
  destination: Destination;
  Icon: ComponentType<{ size?: number }>;
  /** Only Issues carries a count, and only ever the one. */
  showsDecisionCount?: boolean;
  requiresProjectAdmin?: boolean;
}

/**
 * One flat register of destinations — no groups, no dividers. Labels and paths
 * come from the vocabulary registry so the nav cannot drift from it.
 */
const navItems: readonly NavItem[] = [
  { destination: "issues", Icon: WarningDiamondIcon, showsDecisionCount: true },
  { destination: "pages", Icon: PagesIcon },
  { destination: "watchlist", Icon: EyeIcon, requiresProjectAdmin: true },
  { destination: "settings", Icon: GearIcon, requiresProjectAdmin: true },
];

/**
 * The sidebar's one numeric badge: how many issue cases are waiting in Decide.
 * The count itself comes from `decideQueueCount`, so chunk F2 can repoint it at
 * real issue cases without touching this file.
 *
 * It is a magnitude, not a work state (F3 R3): weight carries the emphasis and
 * the pill is plain chrome. Deliberately not a <StatusChip> — a queue depth is
 * a quantity, and giving it a status tone would put "how many are waiting"
 * into the same vocabulary as "what state is this case in".
 */
function DecisionBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} in ${QUEUE_LABEL.decide}`}
      style={{
        marginLeft: "auto",
        // 12px, not 11: the count carries meaning, and the registry's chip rule
        // and F3's type floor both settled on 12 as the minimum for anything
        // that does.
        fontSize: 12,
        fontWeight: MAGNITUDE_WEIGHT,
        color: "var(--magnitude-value)",
        fontVariantNumeric: "tabular-nums",
        background: "var(--surface-input)",
        padding: "1px 8px",
        borderRadius: 20,
      }}
    >
      {count}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    recs,
    pathFor,
    collectionSchedule,
    projects,
    project,
    projectSwitching,
    switchProject,
    user,
    canManageProject,
    appearance,
    setAppearance,
  } = useStore();
  const [devEmail, setDevEmail] = useState(user.email);
  const [signingOut, setSigningOut] = useState(false);
  const decisionCount = decideQueueCount(recs);

  const schedule = normalizeCollectionSchedule(collectionSchedule);
  const visibleNavItems = navItems.filter((item) => canManageProject || !item.requiresProjectAdmin);

  return (
    <aside
      className="app-sidebar"
      style={{
        width: 244,
        flex: "none",
        background: "var(--surface-page)",
        borderRight: "1px solid var(--border-hairline)",
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
            router.push(pathFor(DESTINATION_PATH.issues));
          }}
        />
      </div>

      <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 12px" }}>
        {visibleNavItems.map(({ destination, Icon, showsDecisionCount }) => {
          const href = DESTINATION_PATH[destination];
          const label = DESTINATION_LABEL[destination];
          const resolvedHref = pathFor(href);
          const active = pathname === resolvedHref
            || (destination === "issues" && pathname === pathFor("/"))
            || (destination === "pages" && pathname.startsWith(`${resolvedHref}/`));
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
                // Selected state is uniform across the app: the mark is
                // --action-primary-bg, the surface is --surface-raised.
                color: active ? "var(--action-primary-ink)" : "var(--text-muted)",
                background: active ? "var(--surface-raised)" : "transparent",
              }}
            >
              <Icon size={17} />
              <span className="sidebar-link-label">{label}</span>
              {showsDecisionCount && !projectSwitching && decisionCount > 0 && (
                <DecisionBadge count={decisionCount} />
              )}
            </Link>
          );
        })}
      </nav>

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
            color: pathname === pathFor("/admin") ? "var(--action-primary-ink)" : "var(--text-muted)",
            background: pathname === pathFor("/admin") ? "var(--surface-raised)" : "transparent",
            textDecoration: "none",
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          <ShieldCheckIcon size={16} />
          <span>Admin</span>
        </Link>
        }
        {/*
          The schedule is one row of chrome now, not an eyebrow over a card.
          It keeps the `sidebar-schedule` class so the narrow-rail rule that
          hides it still matches.

          12px, not the 11.5px the chunk first specified: a run time is
          meaning, and the registry withdrew the 11px floor as contradicting
          F3. `--text-secondary` does not exist in the token layer either, so
          this takes `--text-muted`, where the migration mapping sends the
          greys it was standing in for.
        */}
        <div
          className="sidebar-schedule"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderTop: "1px solid var(--border-hairline)",
            marginTop: 8,
            padding: "12px 10px 0",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {/* Decoration beside the schedule, not an action — plain chrome. */}
          <ClockIcon size={14} style={{ flex: "none" }} />
          {/* Wraps rather than truncates: an ellipsised zone ("America/Chic…")
              is worse than a second line, because the zone is the half that
              tells you whether 02:30 is your 02:30. */}
          <span style={{ minWidth: 0, lineHeight: 1.4 }}>
            {projectSwitching ? "Loading project…" : `Next run ${schedule.localTime} ${schedule.timeZone}`}
          </span>
        </div>

        <div style={{ marginTop: 12, padding: "0 10px" }}>
          <AppearanceControl value={appearance} onChange={setAppearance} />
        </div>

        <div style={{ borderTop: "1px solid var(--border-hairline)", marginTop: 12, padding: "12px 10px 0", fontSize: 12, color: "var(--text-muted)" }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
          {/*
            The two greys this line and its sibling used to split now both
            land on --text-muted, so it inherits. The two-step grey ramp
            that used to separate the email from the role is gone by design;
            flagged for review rather than re-created with a second grey.
          */}
          <div style={{ marginTop: 3 }}>{user.isAppAdmin ? "App admin" : project.accessRole === "project_admin" ? "Project admin" : "Project viewer"}</div>
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
                style={{ minWidth: 0, width: "100%", border: "1px solid var(--border-hairline)", borderRadius: 6, background: "var(--surface-input)", color: "var(--text-body)", padding: "6px 7px", fontSize: 12 }}
              />
              <button type="submit" style={{ border: "1px solid var(--border-hairline)", borderRadius: 6, background: "var(--surface-raised)", color: "var(--text-body)", padding: "0 8px", cursor: "pointer" }}>Use</button>
            </form>
          )}
          {!user.development && (
            <button
              type="button"
              className="sidebar-sign-out"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                const accessWindow = window.open("", "page-watch-secure-logout", "popup,width=480,height=360");
                if (accessWindow) {
                  accessWindow.document.title = "Signing out of Page Watch";
                  accessWindow.document.body.textContent = "Completing secure sign-out…";
                }
                clearPageWatchBrowserState(window.localStorage, window.sessionStorage);
                try {
                  const response = await fetch(pathFor("/api/auth/logout"), { method: "POST" });
                  const body = await response.json().catch(() => ({})) as {
                    redirectTo?: string;
                    accessLogoutUrls?: string[];
                  };
                  if (!response.ok) throw new Error("Sign out failed");
                  const logoutUrls = Array.isArray(body.accessLogoutUrls) ? body.accessLogoutUrls : [];
                  if (accessWindow && logoutUrls.length) {
                    for (const logoutUrl of logoutUrls) {
                      if (accessWindow.closed) break;
                      accessWindow.location.replace(logoutUrl);
                      await wait(ACCESS_LOGOUT_STEP_MS);
                    }
                    accessWindow.close();
                    window.location.replace(pathFor(body.redirectTo ?? "/login?signedOut=1"));
                    return;
                  }
                  if (logoutUrls[0]) {
                    window.location.replace(logoutUrls[0]);
                    return;
                  }
                  window.location.replace(pathFor(body.redirectTo ?? "/login?signedOut=1"));
                } catch {
                  accessWindow?.close();
                  setSigningOut(false);
                }
              }}
            >
              <SignOutIcon size={14} />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
