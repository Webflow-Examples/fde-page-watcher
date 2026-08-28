"use client";

import { Info } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * An icon that says more, on hover and on demand.
 *
 * This replaced a disclosure that expanded the row in place. The disclosure was
 * correct in the abstract and wrong here: the row it sat in is itself a link,
 * so the reader was asked to hit an 18px control inside a target that navigates
 * away if they miss — and the reward for hitting it was the list reflowing
 * under the pointer. A tip that appears over the row costs no layout and no
 * accuracy.
 *
 * It is a TOGGLETIP rather than a tooltip, because it answers to a click as
 * well as a hover, and the two behave differently on purpose:
 *
 *   hover   opens while the pointer is on the icon or the panel, and closes
 *           when it leaves both.
 *   click   pins it open, and clicking again puts it away. Space and Enter are
 *           the same event on a real `<button>`, so the keyboard gets this for
 *           free rather than through a key handler that has to be kept in step.
 *
 * Focus alone does NOT open it. That is the toggletip half of the pattern: a
 * keyboard reader tabbing along a list of these would otherwise have a panel
 * open over the row at every stop, and the panel is not where they are going.
 * Space is the ask, and `aria-expanded` says what it did.
 *
 * WCAG 1.4.13 (content on hover or focus) wants three things of hover content,
 * and each one is a line of code here rather than an accident:
 *
 *   dismissible   Escape closes it and leaves focus where it was.
 *   hoverable     the pointer can travel from the icon onto the panel — hence
 *                 `CLOSE_DELAY_MS`, because the panel is `position: fixed` and
 *                 the trip between them crosses elements belonging to neither.
 *   persistent    nothing closes it on a timer.
 */

/** Distance from the icon, and the smallest gap allowed to the viewport edge. */
const GAP = 6;
const EDGE = 8;

/**
 * How long the panel survives the pointer leaving the icon.
 *
 * Long enough to cross the gap between them, short enough not to feel stuck.
 * Without it the tip is not *hoverable* — you can see the text and cannot put
 * the pointer on it to read to the end of a long line.
 */
const CLOSE_DELAY_MS = 120;

export interface InfoTipProps {
  /**
   * What the tip is about. It becomes the button's accessible name, so it
   * should read as a thing rather than as an instruction.
   */
  label: string;
  /** The text the tip shows. */
  text: string;
}

export function InfoTip({ label, text }: InfoTipProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();
  const open = hovering || pinned;

  const cancelClose = useCallback(() => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const holdOpen = useCallback(() => {
    cancelClose();
    setHovering(true);
  }, [cancelClose]);

  const releaseHover = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovering(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  /**
   * Fixed, and measured against the viewport, for the same reason
   * `.select-menu__popover` is: an absolutely positioned panel is clipped by
   * whichever ancestor happens to scroll, and in a list that ancestor is the
   * row. Re-placed on scroll in the capture phase, because the thing that
   * scrolls is a container rather than the window.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const anchor = trigger.getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      const fitsBelow = anchor.bottom + GAP + box.height <= window.innerHeight - EDGE;
      setPosition({
        left: Math.min(Math.max(EDGE, anchor.left), Math.max(EDGE, window.innerWidth - box.width - EDGE)),
        top: fitsBelow ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - box.height - GAP),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, text]);

  /** A click anywhere else puts a pinned tip away. */
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [pinned]);

  return (
    <span
      className="info-tip"
      onPointerEnter={holdOpen}
      onPointerLeave={releaseHover}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Dismissed where it stands. Focus does not move, which is the whole
        // requirement — a reader who escapes a tip has not asked to go
        // anywhere.
        event.stopPropagation();
        cancelClose();
        setHovering(false);
        setPinned(false);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setPinned(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="info-tip__button"
        // The state lives on `aria-expanded`, so the NAME can hold still. A
        // name that changes as you operate the control is a name a voice user
        // cannot say twice.
        aria-label={`Diagnosis for ${label}`}
        aria-expanded={open}
        // Only while the panel exists: an `aria-controls` pointing at an id
        // that is not in the document is a broken reference, not an empty one.
        aria-controls={open ? tipId : undefined}
        onClick={() => setPinned((wasPinned) => !wasPinned)}
      >
        <Info size={14} weight="bold" aria-hidden="true" />
      </button>

      {/*
        The live region is always mounted and the text is put INTO it when the
        tip opens, which is what makes a screen reader read it out. A panel that
        only appears in the DOM is a panel nothing announces: `aria-expanded`
        reports that something opened, and never says what it said.
      */}
      <span role="status">
        {open ? (
          <span
            ref={panelRef}
            id={tipId}
            className="info-tip__panel"
            style={{ left: position.left, top: position.top }}
            onPointerEnter={holdOpen}
            onPointerLeave={releaseHover}
          >
            {text}
          </span>
        ) : null}
      </span>
    </span>
  );
}
