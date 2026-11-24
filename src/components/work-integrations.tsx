"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/components/store";
import type { PublicIntegrationSettings, PublicConnection, TaskLinkRecord } from "@/lib/integrations/types";
import type { WorkState } from "@/lib/issue-case";

/**
 * The browser half of a task-tool connection.
 *
 * Two rules from DECISIONS.md 7 shape everything here:
 *
 *   1. A link is a pointer, not a second lifecycle. The panel shows the task
 *      tool's own state word, its assignee and its URL; it never maps that word
 *      onto a Page Watch state.
 *   2. A completion is a signal. When the tool reports one, the panel says so
 *      and offers Mark fixed — the header's own transition — and never Resolve
 *      (there is no such control to offer).
 *
 * Viewer access: a viewer sees a link and cannot create, refresh or unlink.
 * Those are project-admin writes, the same gate every other mutation uses.
 */

export interface WorkIntegrationNote {
  at: string;
  text: string;
  linkId: string;
  provider: string;
  kind: "completed" | "canceled";
}

export interface WorkIntegrationData {
  connections: PublicConnection[];
  links: TaskLinkRecord[];
  settings: PublicIntegrationSettings;
  notes: WorkIntegrationNote[];
  oauthConfigured: { asana: boolean; linear: boolean };
  credentialReady: boolean;
}

export type WorkIntegrationRequest = <T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  method?: string,
) => Promise<T>;

export function useWorkIntegrations(enabled = true): {
  data: WorkIntegrationData | null;
  error: string | null;
  refresh: () => Promise<void>;
  request: WorkIntegrationRequest;
} {
  const { pathFor } = useStore();
  const [data, setData] = useState<WorkIntegrationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(pathFor("/api/integrations/state"), { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Could not read integration state (${response.status})`);
      setData(payload as WorkIntegrationData);
      setError(null);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    }
  }, [pathFor]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(pathFor("/api/integrations/state"), {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `Could not read integration state (${response.status})`);
        if (!cancelled) {
          setData(payload as WorkIntegrationData);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(String(cause instanceof Error ? cause.message : cause));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, pathFor]);

  const request = useCallback(async <T,>(path: string, body?: unknown, method = "POST"): Promise<T> => {
    const response = await fetch(pathFor(path), {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
    await refresh();
    return payload as T;
  }, [pathFor, refresh]);

  return { data, error, refresh, request: request as WorkIntegrationRequest };
}

export const PROVIDER_LABEL = { asana: "Asana", linear: "Linear" } as const;

function firstConnection(data: WorkIntegrationData | null): PublicConnection | null {
  return data?.connections.find((connection) => connection.status !== "disconnected") ?? null;
}

function linkFor(data: WorkIntegrationData | null, remediationKey: string, provider?: string): TaskLinkRecord | null {
  if (!data) return null;
  return data.links.find((link) =>
    link.remediationKey === remediationKey && (!provider || link.provider === provider)) ?? null;
}

export interface WorkTaskActionProps {
  remediationKey: string;
  caseId: string;
  caseState: WorkState;
  hasPlan: boolean;
  /** Record Accept optimistically; the create is a separate act. */
  onAccept?: () => void;
  /** The registry transition the completion offer points at. */
  onMarkFixed?: () => void;
}

/**
 * The header's integration action, and the linked task beneath it.
 *
 * "Accept and create task" is two acts in one click: Accept first, through the
 * ordinary decision log, then the create. A failed create leaves the Accept
 * standing, which is exactly what a person who pressed Accept and then found
 * the tool unreachable would have.
 */
export function WorkTaskAction({
  remediationKey,
  caseId,
  caseState,
  hasPlan,
  onAccept,
  onMarkFixed,
}: WorkTaskActionProps) {
  const { canManageProject } = useStore();
  const { data, error, request } = useWorkIntegrations(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const connection = firstConnection(data);
  const link = linkFor(data, remediationKey, connection?.provider);
  const notes = link ? (data?.notes ?? []).filter((note) => note.linkId === link.id) : [];

  const run = useCallback(async (work: () => Promise<string | null>) => {
    setBusy(true);
    setFailure(null);
    setMessage(null);
    try {
      const result = await work();
      if (result) setMessage(result);
    } catch (cause) {
      setFailure(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(() => {
    if (caseState === "new" || caseState === "reopened") onAccept?.();
    void run(async () => {
      await request("/api/integrations/tasks", { caseId, accept: false });
      return "Task created.";
    });
  }, [caseId, caseState, onAccept, request, run]);

  const refreshLink = useCallback(() => {
    void run(async () => {
      const result = await request<{ completed: boolean; canceled: boolean }>("/api/integrations/tasks/refresh", { remediationKey });
      if (result.completed) return "The task is completed. That is a signal, not a resolution.";
      if (result.canceled) return "The task was canceled. Dismiss the case if the work is off.";
      return "Task refreshed.";
    });
  }, [remediationKey, request, run]);

  const unlink = useCallback(() => {
    void run(async () => {
      await request("/api/integrations/tasks/unlink", { remediationKey });
      return "Unlinked. The task itself is untouched.";
    });
  }, [remediationKey, request, run]);

  const canAct = canManageProject && !busy;
  const offerCreate = !link && connection && canAct && hasPlan && (
    caseState === "new" || caseState === "reopened" || caseState === "todo" || caseState === "in_progress"
  );

  if (!data) return null;
  if (!connection && !link) {
    return canManageProject
      ? (
        <span style={{ maxWidth: "32ch", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
          No task tool is connected. Connect Asana or Linear in Settings, or keep using Copy as ticket.
        </span>
      )
      : null;
  }

  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, maxWidth: "36ch" }}>
      {offerCreate ? (
        <button
          type="button"
          disabled={!canAct}
          onClick={create}
          style={{
            appearance: "none",
            cursor: canAct ? "pointer" : "not-allowed",
            whiteSpace: "nowrap",
            fontSize: 13,
            fontWeight: 500,
            padding: "8px 15px",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--surface-card)",
            color: "var(--text-body)",
            opacity: canAct ? 1 : 0.6,
          }}
        >
          {caseState === "new" || caseState === "reopened" ? `Accept and create task in ${PROVIDER_LABEL[connection!.provider]}` : "Create task"}
        </button>
      ) : null}

      {link ? (
        <span style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
          <span>
            {PROVIDER_LABEL[link.provider]} ·{" "}
            {link.externalUrl ? (
              <a
                href={link.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "var(--action-primary-ink)", textDecoration: "none" }}
              >
                {link.externalState ?? "open"}
              </a>
            ) : (
              <span>{link.externalState ?? "open"}</span>
            )}
            {link.assignee ? ` · ${link.assignee}` : " · unassigned"}
          </span>
          {notes.map((note) => (
            <span key={`${note.at}:${note.kind}`} style={{ color: note.kind === "canceled" ? "var(--status-warning-text)" : "var(--text-muted)" }}>
              {note.text}
            </span>
          ))}
          {canManageProject ? (
            <span style={{ display: "flex", gap: 10 }}>
              <button type="button" disabled={!canAct} onClick={refreshLink} style={LINK_BUTTON}>
                Refresh
              </button>
              <button type="button" disabled={!canAct} onClick={unlink} style={LINK_BUTTON}>
                Unlink
              </button>
              {/* The completion offer. It is Mark fixed — never Resolve, and
                  never automatic. The registry only permits it from In progress,
                  so the sentence says what is true in another state. */}
              {link.externalState === "completed" && data?.settings.automations.taskCompletionOffersMarkFixed ? (
                caseState === "in_progress" && hasPlan && onMarkFixed ? (
                  <button type="button" disabled={!canAct} onClick={onMarkFixed} style={LINK_BUTTON}>
                    Mark fixed
                  </button>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>
                    {caseState === "todo" ? "Start the case to Mark fixed." : "The task is completed; the case still needs deciding."}
                  </span>
                )
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}

      {message ? <span role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--text-muted)" }}>{message}</span> : null}
      {failure ? <span role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--status-warning-text)" }}>{failure}</span> : null}
      {error ? <span style={{ fontSize: 12, color: "var(--status-warning-text)" }}>{error}</span> : null}
    </span>
  );
}

const LINK_BUTTON = {
  appearance: "none" as const,
  cursor: "pointer",
  padding: 0,
  border: 0,
  background: "transparent",
  color: "var(--action-primary-ink)",
  font: "inherit",
  fontSize: 12.5,
  textDecoration: "underline",
};
