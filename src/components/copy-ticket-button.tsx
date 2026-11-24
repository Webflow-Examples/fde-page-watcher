"use client";

import { useCallback, useEffect, useState } from "react";
import { FIX_ACTION_COPY_TICKET, FIX_TICKET_COPIED } from "@/lib/fix-copy";

/**
 * "Copy as ticket" — the case, as plain markdown, on the clipboard.
 *
 * A connected task tool is a second surface for the same ticket, not a second
 * lifecycle: Page Watch owns the problem, the evidence, the lifecycle and the
 * plan, and the task tool owns execution (who, comments, subtasks, delivery).
 * A task completion adds a note and offers Mark fixed; it cannot resolve a case.
 * The rule is stated in DECISIONS.md 7 and implemented in
 * `src/lib/integrations/`.
 *
 * This button remains for two reasons, and both survive the integration. It is
 * the escape hatch for a team with no connection, and it is how a person sends
 * a case somewhere Page Watch does not track at all. A copy holds no state, so
 * it cannot drift; the reader knows they took it and when.
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
    <span style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
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
          // Absolute, so a confirmation line does not make this button taller
          // than the primary action beside it. The message still appears
          // directly under the control that produced it.
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          right: 0,
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
