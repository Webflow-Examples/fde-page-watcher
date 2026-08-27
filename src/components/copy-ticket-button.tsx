"use client";

import { useCallback, useEffect, useState } from "react";
import { FIX_ACTION_COPY_TICKET, FIX_TICKET_COPIED } from "@/lib/fix-copy";

/**
 * "Copy as ticket" — the case, as plain markdown, on the clipboard.
 *
 * The whole integration surface. There is no tracker connection behind this and
 * there is not going to be one: a connection is a second place the work's state
 * lives, and a second place the work's state lives is a place it disagrees with
 * the first. That is the defect the case object exists to remove, and adding it
 * back across a network boundary would put it somewhere nobody can reconcile it.
 * A person pressing this knows they took a copy and knows when.
 *
 * The confirmation is inline and it expires. A toast would appear somewhere else
 * on the screen, which for an action this local means the reader has to look
 * away from the thing they just acted on to find out whether it worked.
 *
 * The failure message is not from the locked list because the locked list has no
 * failure message. A clipboard write can be refused — an insecure origin, a
 * permissions policy, a browser that has never had the API — and a button that
 * says "Copied" when nothing was copied is worse than one that says it could
 * not: the reader pastes an empty ticket into a message and finds out later.
 */

/** How long the confirmation stays up. Long enough to read, short enough to not be furniture. */
const CONFIRMATION_MS = 4000;

const COPY_FAILED = "Couldn't reach the clipboard — copy it from the case instead.";

export interface CopyTicketButtonProps {
  /**
   * The ticket, built by the caller.
   *
   * A string rather than the case, so this component knows nothing about what a
   * ticket contains and cannot grow a second opinion about it. `ticketMarkdown`
   * is the one writer.
   */
  ticket: string;
}

export function CopyTicketButton({ ticket }: CopyTicketButtonProps) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const copy = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(ticket);
        setResult("copied");
      } catch {
        setResult("failed");
      }
    })();
  }, [ticket]);

  return (
    // A column, because the header stacks its actions and a confirmation beside
    // the button would widen the whole column by a sentence.
    <span style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <button
        type="button"
        onClick={copy}
        style={{
          appearance: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontSize: 13,
          fontWeight: 500,
          padding: "8px 15px",
          borderRadius: 8,
          border: "1px solid var(--border-strong)",
          background: "var(--surface-card)",
          color: "var(--text-body)",
        }}
      >
        {FIX_ACTION_COPY_TICKET}
      </button>

      {/* Announced when it arrives, because a reader who pressed the button with
          the keyboard has no other way to learn that it worked. */}
      <span
        role="status"
        aria-live="polite"
        style={{
          maxWidth: "34ch",
          fontSize: 12.5,
          lineHeight: 1.45,
          color: result === "failed" ? "var(--status-warning-text)" : "var(--text-muted)",
        }}
      >
        {result === "copied" ? FIX_TICKET_COPIED : result === "failed" ? COPY_FAILED : ""}
      </span>
    </span>
  );
}
