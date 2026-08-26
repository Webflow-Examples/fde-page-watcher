"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import { useStore } from "@/components/store";
import { naturalDate } from "@/lib/ui";
import { DESTINATION_LABEL } from "@/lib/vocabulary";
import { SegToggle } from "@/components/bits";
import { Magnitude } from "@/components/magnitude";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { flagCapacityError, MAX_ACTIVE_PAGES, MAX_PRIORITY_PAGES, watchCapacity } from "@/lib/watchCapacity";
import { movePageWithinFlag, reorderPageWithinFlag, sortWatchlistPages } from "@/lib/watchlistOrder";
import { failedRunLabel } from "@/lib/collectionStatus";
import { PageHeader } from "@/components/page-header";

/**
 * The watchlist, and only the watchlist.
 *
 * It carried the settings screen as a second mode until S8 — one component, one
 * `mode` prop, and two pages that shared a header and nothing else. Settings is
 * its own route now, so what is left here is the page list, the flags, and the
 * reordering.
 *
 * Nothing on this screen sets a threshold, and nothing on it carries a severity.
 * Both had gone by the time S8 looked; what this chunk removed was the tolerance
 * panel below, which was the last threshold UI anywhere in the app outside
 * /settings.
 */

const GRID = "32px minmax(228px,2.4fr) 230px 1fr 120px";
type WatchlistDropTarget = { pageId: string; position: "before" | "after" };

function EditablePageTitle({
  pageId,
  title,
  onSave,
  disabled = false,
}: {
  pageId: string;
  title: string;
  onSave: (id: string, title: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const cancelPending = useRef(false);

  const beginEdit = () => {
    cancelPending.current = false;
    setDraft(title);
    setEditing(true);
  };

  const finishEdit = () => {
    if (cancelPending.current) {
      cancelPending.current = false;
      return;
    }
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) onSave(pageId, next);
    else setDraft(title);
  };

  if (editing) {
    return (
      <input
        aria-label={`Page name for ${title}`}
        value={draft}
        maxLength={120}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finishEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelPending.current = true;
            setDraft(title);
            setEditing(false);
          }
        }}
        style={{
          width: "100%",
          margin: "-5px -8px",
          padding: "4px 7px",
          border: "1px solid var(--focus-ring)",
          borderRadius: 5,
          outline: "none",
          background: "var(--surface-input)",
          boxShadow: "0 0 0 3px color-mix(in srgb, var(--focus-ring) 25%, transparent)",
          color: "var(--text-body)",
          font: "inherit",
          fontSize: 14,
          fontWeight: 600,
        }}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Edit page name: ${title}`}
      title="Click to edit page name"
      onClick={beginEdit}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        overflow: "hidden",
        padding: 0,
        border: "none",
        background: "transparent",
        color: "var(--text-body)",
        fontSize: 14,
        fontWeight: 600,
        lineHeight: "normal",
        textAlign: "left",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        cursor: "text",
      }}
    >
      {title}
    </button>
  );
}

function WatchlistContent() {
  const router = useRouter();
  const {
    pages,
    setFlag,
    reorderPages,
    renamePage,
    removePage,
    openAdd,
    pathFor,
    canManageProject,
  } = useStore();
  const orderedPages = useMemo(() => sortWatchlistPages(pages), [pages]);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WatchlistDropTarget | null>(null);
  const [keyboardDragPageId, setKeyboardDragPageId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const capacity = watchCapacity(pages);

  const persistReorder = (
    pageId: string,
    targetId: string,
    position: WatchlistDropTarget["position"],
  ) => {
    const next = reorderPageWithinFlag(orderedPages, pageId, targetId, position);
    if (next.every((page, index) => page.id === orderedPages[index]?.id)) return false;
    reorderPages(next.map((page) => page.id));
    const movedPage = next.find((page) => page.id === pageId);
    const tier = next.filter((page) => page.flag === movedPage?.flag);
    const tierIndex = tier.findIndex((page) => page.id === pageId);
    setReorderAnnouncement(
      `${movedPage?.title ?? "Page"} moved to position ${tierIndex + 1} of ${tier.length} in ${movedPage?.flag ?? "its group"}.`,
    );
    return true;
  };

  const moveKeyboardPage = (pageId: string, direction: -1 | 1) => {
    const next = movePageWithinFlag(orderedPages, pageId, direction);
    const movedPage = next.find((page) => page.id === pageId);
    const changed = next.some((page, index) => page.id !== orderedPages[index]?.id);
    if (!changed || !movedPage) {
      setReorderAnnouncement(`This page is already at the ${direction < 0 ? "start" : "end"} of its ${movedPage?.flag ?? "current"} group.`);
      return;
    }
    reorderPages(next.map((page) => page.id));
    const tier = next.filter((page) => page.flag === movedPage.flag);
    const tierIndex = tier.findIndex((page) => page.id === pageId);
    setReorderAnnouncement(`${movedPage.title} moved to position ${tierIndex + 1} of ${tier.length} in ${movedPage.flag}.`);
  };

  const dropTargetAtPoint = (pageId: string, x: number, y: number): WatchlistDropTarget | null => {
    const targetRow = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-watchlist-page]");
    const targetId = targetRow?.dataset.watchlistPage;
    if (!targetRow || !targetId || targetId === pageId) return null;
    const page = orderedPages.find((item) => item.id === pageId);
    const target = orderedPages.find((item) => item.id === targetId);
    if (!page || !target || page.flag !== target.flag) return null;
    const bounds = targetRow.getBoundingClientRect();
    return {
      pageId: targetId,
      position: y < bounds.top + (bounds.height / 2) ? "before" : "after",
    };
  };

  return (
    <div>
      <PageHeader
        title={DESTINATION_LABEL.watchlist}
        purpose="Priority and Watching pages are monitored nightly. Paused pages keep their history without collecting new data."
        action={canManageProject ? (
          <button
            onClick={openAdd}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", border: "none", borderRadius: 8, background: "var(--action-primary-bg)", color: "var(--action-primary-text)", fontSize: 13, fontWeight: 550, cursor: "pointer" }}
          >
            <PlusIcon size={15} style={{ color: "var(--action-primary-text)" }} />
            Add page
          </button>
        ) : undefined}
      />

      <div style={{ padding: "0 40px 48px" }}>
        <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 24px", borderBottom: "1px solid var(--border-hairline)", fontSize: 12, color: "var(--text-muted)" }}>
            <Magnitude value={`${capacity.active}/${MAX_ACTIVE_PAGES}`} unit="active" fontSize={12} />
            <Magnitude value={`${capacity.priority}/${MAX_PRIORITY_PAGES}`} unit="Priority" fontSize={12} />
            <Magnitude value={capacity.paused} unit="Paused" fontSize={12} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 24px", borderBottom: "1px solid var(--border-hairline)", fontSize: 12, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            <div aria-hidden="true" />
            <div>Page</div>
            <div>Flag</div>
            <div>Baseline</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>
          <p id="watchlist-reorder-instructions" className="visually-hidden">
            Drag a page handle to reorder it within its current monitoring group. With the handle focused, press Space or Enter to pick up the page, use the Up and Down arrow keys to move it, then press Space or Enter again to drop it. Press Escape to cancel.
          </p>
          <div className="visually-hidden" aria-live="polite" aria-atomic="true">
            {reorderAnnouncement}
          </div>
          {orderedPages.map((p) => {
            const priorityError = flagCapacityError(pages, p.id, "priority");
            const watchingError = flagCapacityError(pages, p.id, "watching");
            const pauseBlocked = !!p.runState && p.runState !== "failed";
            const keyboardDragging = keyboardDragPageId === p.id;
            const isDropTarget = dropTarget?.pageId === p.id;
            return (
            <div
              key={p.id}
              data-watchlist-page={p.id}
              className={`watchlist-page-row${draggedPageId === p.id ? " is-dragging" : ""}${keyboardDragging ? " is-keyboard-dragging" : ""}${isDropTarget ? ` is-drop-${dropTarget.position}` : ""}`}
              style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "15px 24px", borderBottom: "1px solid var(--border-hairline)" }}
            >
              <button
                type="button"
                className={`watchlist-drag-handle${keyboardDragging ? " is-grabbed" : ""}`}
                aria-label={`Drag ${p.title} to reorder within ${p.flag}`}
                aria-describedby="watchlist-reorder-instructions"
                aria-pressed={keyboardDragging}
                title={`Drag to reorder within ${p.flag}`}
                disabled={!canManageProject}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus();
                  setKeyboardDragPageId(null);
                  setDraggedPageId(p.id);
                  setDropTarget(null);
                  setReorderAnnouncement(`Dragging ${p.title}. Drop it on another ${p.flag} page.`);
                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const nextTarget = dropTargetAtPoint(p.id, moveEvent.clientX, moveEvent.clientY);
                    setDropTarget((current) => (
                      current?.pageId === nextTarget?.pageId && current?.position === nextTarget?.position
                        ? current
                        : nextTarget
                    ));
                  };
                  const handleMouseUp = (upEvent: MouseEvent) => {
                    window.removeEventListener("mousemove", handleMouseMove);
                    window.removeEventListener("mouseup", handleMouseUp);
                    const nextTarget = dropTargetAtPoint(p.id, upEvent.clientX, upEvent.clientY);
                    if (nextTarget) persistReorder(p.id, nextTarget.pageId, nextTarget.position);
                    setDraggedPageId(null);
                    setDropTarget(null);
                  };
                  window.addEventListener("mousemove", handleMouseMove);
                  window.addEventListener("mouseup", handleMouseUp);
                }}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    if (keyboardDragging) {
                      setKeyboardDragPageId(null);
                      setReorderAnnouncement(`${p.title} dropped.`);
                    } else {
                      setKeyboardDragPageId(p.id);
                      setReorderAnnouncement(`${p.title} picked up. Use the Up and Down arrow keys to move it within ${p.flag}.`);
                    }
                    return;
                  }
                  if (!keyboardDragging) return;
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    moveKeyboardPage(p.id, event.key === "ArrowUp" ? -1 : 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setKeyboardDragPageId(null);
                    setReorderAnnouncement(`Reordering ${p.title} cancelled.`);
                  }
                }}
              >
                <DotsSixVerticalIcon size={17} weight="bold" aria-hidden="true" />
              </button>
              <div style={{ minWidth: 0, paddingRight: 16 }}>
                <EditablePageTitle pageId={p.id} title={p.title} onSave={renamePage} disabled={!canManageProject} />
                <div
                  aria-label={`Locked URL for ${p.title}: ${p.url}`}
                  title="The watched URL is locked"
                  style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, userSelect: "text" }}
                >
                  {p.url}
                </div>
              </div>
              <div>
                <SegToggle
                  label={`Flag for ${p.title}`}
                  value={p.flag}
                  onChange={(f) => setFlag(p.id, f)}
                  options={[
                    { value: "priority", label: "Priority", disabled: !canManageProject || (p.flag !== "priority" && !!priorityError), title: p.flag !== "priority" ? priorityError ?? undefined : undefined },
                    { value: "watching", label: "Watching", disabled: !canManageProject || (p.flag !== "watching" && !!watchingError), title: p.flag !== "watching" ? watchingError ?? undefined : undefined },
                    { value: "paused", label: "Paused", disabled: !canManageProject || (p.flag !== "paused" && pauseBlocked), title: pauseBlocked ? "Wait for the current collection to finish before pausing" : undefined },
                  ]}
                />
              </div>
              <div style={{ fontSize: 12.5, color: p.runState === "failed" ? "var(--status-danger-text)" : "var(--status-neutral-text)" }}>
                {p.flag === "paused"
                  ? "History retained"
                  : p.runState === "queued"
                  ? "Collection queued"
                  : p.runState === "dispatching"
                    ? "Collector starting"
                    : p.runState === "running"
                      ? "Collection running"
                      : p.runState === "waiting_for_evidence"
                        ? "Waiting for independent test evidence"
                      : p.runState === "failed"
                        ? failedRunLabel(p)
                        : p.lastCollectionStatus === "partial"
                          ? "Partial collection retained · missing tests will retry"
                        : p.lastCollectionStatus === "inconclusive"
                          ? "Measurement inconclusive · previous trusted score retained"
                        : p.baselineCapturedAt
                          ? `Captured ${naturalDate(p.baselineCapturedAt)}`
                          : "No baseline yet"}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => router.push(pathFor(`/pages/${p.id}`))}
                  style={{ border: "1px solid var(--border-strong)", background: "var(--surface-input)", color: "var(--text-body)", fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 7, cursor: "pointer" }}
                >
                  View
                </button>
                {canManageProject && <button
                  onClick={() => removePage(p.id)}
                  aria-label={`Remove ${p.title} from the watchlist`}
                  title="Remove from watchlist"
                  style={{ border: "1px solid var(--action-destructive-border)", background: "transparent", padding: "6px 9px", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center" }}
                >
                  <TrashIcon size={15} style={{ color: "var(--action-destructive-text)" }} />
                </button>}
              </div>
            </div>
          );})}
        </div>
      </div>
    </div>
  );
}

export default function WatchlistPage() {
  const { canManageProject, pathFor } = useStore();
  const router = useRouter();
  useEffect(() => {
    if (!canManageProject) router.replace(pathFor("/dashboard"));
  }, [canManageProject, pathFor, router]);
  if (!canManageProject) return null;
  return <WatchlistContent />;
}
