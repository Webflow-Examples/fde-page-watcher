"use client";

import { useState } from "react";
import { useStore } from "@/components/store";
import { CASE_BATCH_LIMIT, previewBulk } from "@/lib/integrations/preview";
import type { TaskLinkRecord, TaskProviderKind } from "@/lib/integrations/types";
import type { AppState } from "@/lib/types";

/**
 * The bulk action bar for the issues list.
 *
 * Multi-selection is a convenience for a decision that is still per-remediation.
 * One task per remediation: selecting both cases of one fix asks for one task,
 * and the sentence above the button says so before anything is created. A case
 * with no plan is skipped with its reason, and a provider failure on one item
 * does not undo the items that succeeded — partial success is shown as exactly
 * that.
 */

export interface BulkResultItem {
  caseId: string;
  remediationKey?: string;
  status: "created" | "already_linked" | "skipped" | "failed";
  reason?: string;
}

const STATUS_WORD: Record<BulkResultItem["status"], string> = {
  created: "Created",
  already_linked: "Already linked",
  skipped: "Skipped",
  failed: "Failed",
};

export function WorkBulkBar({
  selectionIds,
  state,
  links,
  provider,
  mode,
  onClear,
  onFinished,
}: {
  selectionIds: readonly string[];
  state: AppState;
  links: readonly TaskLinkRecord[];
  provider: TaskProviderKind;
  mode: "decide" | "fix";
  onClear: () => void;
  onFinished: () => void;
}) {
  const { pathFor } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkResultItem[] | null>(null);

  const preview = previewBulk({ state, links, provider, caseIds: selectionIds });
  const tooMany = selectionIds.length > CASE_BATCH_LIMIT;
  const sentence = [
    `${preview.cases} ${preview.cases === 1 ? "case" : "cases"}`,
    `${preview.tasks} ${preview.tasks === 1 ? "task" : "tasks"}`,
    `${preview.alreadyLinked} already linked`,
    `${preview.withoutPlan} without a plan`,
    ...(preview.duplicates > 0 ? [`${preview.duplicates} sharing a fix`] : []),
  ].join(", ") + ".";

  const send = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(pathFor("/api/integrations/tasks/bulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseIds: selectionIds, accept: mode === "decide" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      setResults(payload.results as BulkResultItem[]);
      onFinished();
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  };

  const failed = results?.filter((result) => result.status === "failed").length ?? 0;

  return (
    <div
      role="region"
      aria-label="Selected cases"
      style={{
        margin: "0 40px 12px",
        padding: "10px 12px",
        border: "1px solid var(--border-strong)",
        borderRadius: 9,
        background: "var(--surface-raised)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-body)" }}>{sentence}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={onClear}
            style={{ appearance: "none", border: 0, background: "transparent", color: "var(--text-muted)", font: "inherit", fontSize: 12.5, cursor: "pointer" }}
          >
            Clear selection
          </button>
          <button
            type="button"
            disabled={busy || tooMany || preview.tasks + preview.alreadyLinked === 0}
            onClick={send}
            style={{
              appearance: "none",
              cursor: busy || tooMany ? "not-allowed" : "pointer",
              padding: "7px 12px",
              borderRadius: 7,
              border: "1px solid var(--border-strong)",
              background: "var(--action-primary-bg)",
              color: "var(--action-primary-text)",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 550,
              opacity: busy || tooMany ? 0.55 : 1,
            }}
          >
            {mode === "decide" ? "Accept and create tasks" : "Create tasks"}
          </button>
        </span>
      </div>

      {tooMany ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--status-warning-text)" }}>
          A selection is capped at {CASE_BATCH_LIMIT} cases. Clear some and try again.
        </p>
      ) : null}

      {results ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2, maxHeight: 160, overflow: "auto" }}>
          {results.map((result) => (
            <li key={result.caseId} style={{ fontSize: 12, color: result.status === "failed" ? "var(--status-warning-text)" : "var(--text-muted)" }}>
              {result.caseId} — {STATUS_WORD[result.status]}
              {result.reason ? `: ${result.reason}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {results ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
          {failed === 0 ? "Every item was handled. Nothing is all-or-nothing here." : `${failed} item${failed === 1 ? "" : "s"} failed; the rest succeeded.`}
        </p>
      ) : null}
      {error ? <p style={{ margin: 0, fontSize: 12, color: "var(--status-warning-text)" }}>{error}</p> : null}
    </div>
  );
}
