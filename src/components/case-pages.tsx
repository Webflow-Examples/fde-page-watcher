"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  applicabilityOf,
  exclusionReasonOf,
  excludedPageIds,
  includedPages,
  type IssueCase,
} from "@/lib/issue-case";
import { applicabilityActionLabel, type ExclusionReason } from "@/lib/vocabulary";
import { excludedNote, pagesCount } from "@/lib/case-copy";
import { formatImpact } from "@/lib/impact-format";
import { ExclusionReasonPicker } from "@/components/exclusion-reason-picker";
import { useStore } from "@/components/store";

/**
 * The pages this case covers, and which of them it counts (4b).
 *
 * Every page is included by default. The alternative designs were both
 * considered and rejected, and neither should come back:
 *
 *   4a all-or-nothing accept — makes one unrelated page enough to block a fix
 *      that six other pages need.
 *   4c per-page cases — turns one problem into six rows, six decisions and six
 *      histories, which is the arithmetic S1 exists to prevent.
 *
 * So the case stays one case and the pages carry the applicability. That is the
 * registry's existing concept applied to a new object: exclude with a reason,
 * include to undo. No new word, and no second lifecycle running beside the
 * case's own state.
 *
 * An excluded page keeps its row and its reading, struck through, with the
 * reason beside it. Excluding is not deleting — the audit is explicit that
 * hiding evidence without saying why is how the agent tab lost trust.
 */

export interface CasePagesProps {
  issue: IssueCase;
  pageTitles: Record<string, string>;
  pagePaths?: Record<string, string>;
  /**
   * Wire these to expose the exclude and include controls.
   *
   * Absent means read-only, and that is not a styling choice: the control is
   * only offered where the change can be KEPT. A case is derived from the
   * collector's records, so until there is somewhere to persist an exclusion
   * (F5) a button here would take the reader's decision, show it, and lose it
   * on reload — which is precisely the trust failure this product exists to
   * fix. The table still shows every page, and still renders an exclusion it is
   * given, so nothing about the reading is hidden meanwhile.
   */
  onExclude?: (pageId: string, reason: ExclusionReason) => void;
  onInclude?: (pageId: string) => void;
  /** Per-page readings, where the case has them. Absent means unmeasured. */
  impactByPage?: Record<string, number>;
}


export function CasePages({
  issue,
  pageTitles,
  pagePaths,
  onExclude,
  onInclude,
  impactByPage,
}: CasePagesProps) {
  const { pathFor } = useStore();
  const [choosingFor, setChoosingFor] = useState<string | null>(null);
  const included = includedPages(issue);
  const excluded = excludedPageIds(issue);
  // Two conditions, both of them about whether the change is real:
  //   - a handler exists, so the decision can be kept (see the prop note);
  //   - more than one page is counted, because the model refuses to exclude the
  //     last one — a case that counts nothing is a Dismiss.
  // The button says so by not being there rather than by being greyed out.
  const canExclude = Boolean(onExclude) && included.length > 1;
  const canInclude = Boolean(onInclude);

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-body)" }}>
          Affected pages
        </h2>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {pagesCount(included.length, excluded.length)}
        </span>
      </div>

      <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 10, overflow: "hidden" }}>
        {issue.pageIds.map((pageId, index) => {
          const isExcluded = applicabilityOf(issue, pageId) === "excluded";
          const reason = exclusionReasonOf(issue, pageId);
          const impact = formatImpact(impactByPage?.[pageId] ?? 0);
          const path = pagePaths?.[pageId];
          const label = pageTitles[pageId] ?? path ?? pageId;
          /**
           * Only a page the store still knows gets a link.
           *
           * `issue.pageIds` is the case's own record of what it covers, and a
           * page can leave the watchlist while the case that named it stays.
           * Falling back to the raw id and linking it anyway would send the
           * reader to a 404 — a row that does not navigate is the better of
           * the two failures, so the name still renders, just as text.
           */
          const known = pageTitles[pageId] !== undefined || path !== undefined;
          const nameStyle: CSSProperties = {
            display: "block",
            fontSize: 13,
            color: isExcluded ? "var(--text-muted)" : "var(--text-body)",
            // The reading stays. Struck through says "not counted";
            // removing it would say "never measured", which is a lie.
            textDecoration: isExcluded ? "line-through" : "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          };
          return (
            <div
              key={pageId}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "11px 14px",
                ...(index > 0 ? { borderTop: "1px solid var(--border-hairline)" } : null),
                background: isExcluded ? "var(--surface-raised)" : "transparent",
              }}
            >
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                {known ? (
                  <Link href={pathFor(`/pages/${pageId}`)} style={nameStyle} title={label}>
                    {label}
                  </Link>
                ) : (
                  <div style={nameStyle}>{label}</div>
                )}
                {isExcluded && reason ? (
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)", maxWidth: "70ch" }}>
                    {excludedNote(reason)}
                  </div>
                ) : null}
                {choosingFor === pageId ? (
                  <div style={{ marginTop: 8 }}>
                    <ExclusionReasonPicker
                      onChoose={(chosen) => {
                        setChoosingFor(null);
                        onExclude?.(pageId, chosen);
                      }}
                      onCancel={() => setChoosingFor(null)}
                    />
                  </div>
                ) : null}
              </div>

              <span
                style={{
                  fontSize: 12.5,
                  fontVariantNumeric: "tabular-nums",
                  color: impact.measured && !isExcluded ? "var(--magnitude-value)" : "var(--text-muted)",
                  textDecoration: isExcluded ? "line-through" : "none",
                  flex: "0 0 auto",
                }}
              >
                {impact.text}
              </span>

              {isExcluded && canInclude ? (
                <button
                  type="button"
                  onClick={() => onInclude?.(pageId)}
                  style={{
                    appearance: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: "4px 9px",
                    borderRadius: 6,
                    border: "1px solid var(--border-strong)",
                    background: "var(--surface-card)",
                    color: "var(--text-body)",
                    flex: "0 0 auto",
                  }}
                >
                  {/* The registry names this action, not this file. */}
                  {applicabilityActionLabel("excluded")}
                </button>
              ) : canExclude && choosingFor !== pageId ? (
                <button
                  type="button"
                  onClick={() => setChoosingFor(pageId)}
                  style={{
                    appearance: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    padding: "4px 9px",
                    borderRadius: 6,
                    border: "1px solid var(--border-strong)",
                    background: "var(--surface-card)",
                    color: "var(--text-body)",
                    flex: "0 0 auto",
                  }}
                >
                  {applicabilityActionLabel("included")}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
