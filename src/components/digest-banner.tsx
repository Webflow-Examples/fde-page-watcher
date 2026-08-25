"use client";

import { useState } from "react";
import { DIGEST_ARRIVAL_DISMISS, digestArrivalBanner, digestDate } from "@/lib/digest-copy";

/**
 * Where the reader came from, said once and then gone.
 *
 * The banner answers exactly one question — "is this the thing I clicked in the
 * digest" — and it answers it by repeating the line rather than summarising it.
 * A paraphrase cannot settle a question about identity, and the line is
 * regenerated from the case by `digestLineFor` rather than carried in the URL, so
 * the banner and the message cannot word the same fact differently.
 *
 * It does not persist, and that is structural rather than remembered. The whole
 * of its state is the two query parameters the digest link carried; dismissing it
 * strips them from the URL. There is nothing stored, so there is nothing that
 * could show it again on a later visit — and a reader who opens the case from the
 * list, three weeks after the digest, gets the case and no banner, because the
 * link they followed said nothing about a digest. A flag in local storage would
 * have made "dismissed" durable and "shown" durable with it, which is the wrong
 * half to keep: arriving from a digest is an event, not a property of the case.
 *
 * Nothing about the case is hidden behind it. It sits above the case and takes
 * the case's own width, so dismissing it moves the content up and removes
 * nothing.
 */
export interface DigestBannerProps {
  /** The digest's calendar day, as the message dated it. */
  date: string;
  /** The line the reader clicked, exactly as the message wrote it. */
  line: string;
  /** Drops the arrival out of the URL. Called once, on dismiss. */
  onDismiss: () => void;
  locale?: string;
}

export function DigestBanner({ date, line, onDismiss, locale }: DigestBannerProps) {
  // Local, so the banner goes the instant it is dismissed rather than on the
  // next render the router happens to produce. `onDismiss` cleans the URL behind
  // it, which is what stops a reload bringing it back.
  const [shown, setShown] = useState(true);
  if (!shown) return null;

  return (
    <aside
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        margin: "0 40px",
        padding: "11px 14px",
        borderRadius: 9,
        border: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)",
      }}
    >
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)" }}>
        {digestArrivalBanner(digestDate(date, locale), line)}
      </p>
      <button
        type="button"
        onClick={() => {
          setShown(false);
          onDismiss();
        }}
        aria-label={DIGEST_ARRIVAL_DISMISS}
        style={{
          flex: "none",
          appearance: "none",
          cursor: "pointer",
          border: 0,
          background: "transparent",
          padding: "0 2px",
          font: "inherit",
          fontSize: 12.5,
          fontWeight: 550,
          color: "var(--action-primary-ink)",
        }}
      >
        {/* The word, not a glyph. A bare × on a strip of prose is a control
            whose purpose the reader has to guess, and this one is not urgent
            enough to be worth guessing at. */}
        Dismiss
      </button>
    </aside>
  );
}
