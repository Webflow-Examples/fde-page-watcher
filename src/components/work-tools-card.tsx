"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/components/store";
import { useWorkIntegrations, PROVIDER_LABEL } from "@/components/work-integrations";
import type { AutomationSettings } from "@/lib/integrations/types";
import type { Destination } from "@/lib/integrations/provider";

/**
 * The Task tools card, under Connected systems.
 *
 * What it is: one connection per provider, one default destination, four named
 * automations, an outbound signed event endpoint and a read-only project token.
 * What it is not: a rules engine, a second lifecycle or a place a case's state
 * can be changed. The boundary is DECISIONS.md 7; this card is its control
 * panel, and every control here is a project-admin write.
 */

const AUTOMATION_ROWS: Array<{ key: keyof AutomationSettings; label: string; help: string }> = [
  {
    key: "acceptCreatesTask",
    label: "Accept creates a task",
    help: "The task body is the same ticket Copy as ticket produces, plus a hidden marker. Accept still records the decision first.",
  },
  {
    key: "dismissClosesTask",
    label: "Dismiss closes the task with the dismissal reason",
    help: "The task is completed in the tool you connected; the reason rides in a comment.",
  },
  {
    key: "reopenCommentsAndReopens",
    label: "Reopen comments and reopens the task",
    help: "A reopened case puts the work back in front of the people doing it.",
  },
  {
    key: "taskCompletionOffersMarkFixed",
    label: "Task completion adds a note and offers Mark fixed",
    help: "It never resolves. The 2/7/30-day checks still decide Resolved.",
  },
];

const FIELD_HELP = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--text-muted)",
  margin: 0,
} as const;

const ACTION_BUTTON = {
  appearance: "none" as const,
  cursor: "pointer",
  padding: "7px 12px",
  borderRadius: 7,
  border: "1px solid var(--border-strong)",
  background: "var(--surface-card)",
  color: "var(--text-body)",
  font: "inherit",
  fontSize: 12.5,
};

export function WorkToolsCard({ disabled }: { disabled: boolean }) {
  const { pathFor } = useStore();
  const { data, error, request } = useWorkIntegrations(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [webhookDraft, setWebhookDraft] = useState("");
  const [syncDraft, setSyncDraft] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  const connection = data?.connections.find((candidate) => candidate.status !== "disconnected") ?? null;
  const settings = data?.settings;
  const availableDestinations = connection ? destinations : [];

  // Keep the drafts in step with what the server last stored, without an
  // effect fighting the user mid-typing.
  if (settings && settings.webhookUrl !== syncDraft && !webhookDraft && settings.webhookUrl) {
    setSyncDraft(settings.webhookUrl ?? "");
    setWebhookDraft(settings.webhookUrl ?? "");
  }

  useEffect(() => {
    if (!connection) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch(pathFor(`/api/integrations/${connection.provider}/destinations`), { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (live && response.ok) setDestinations(payload.destinations ?? []);
      } catch {
        // A destination list that cannot be read is shown as an empty list; the
        // connection today still names its stored default.
      }
    })();
    return () => {
      live = false;
    };
  }, [connection?.provider, pathFor, connection]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      setFailure(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: keyof AutomationSettings, value: boolean) => {
    void run(async () => {
      await request("/api/integrations/automations", { automations: { [key]: value } });
    });
  };

  return (
    <div className="settings-system settings-system--stacked">
      <div style={{ minWidth: 0 }}>
        <h3 className="settings-system__name">Task tools</h3>
        <p className="settings-system__note">
          Page Watch keeps the problem, its evidence, its lifecycle and its plan. The tool you connect keeps
          execution: who is doing it, comments, subtasks and delivery. A completed task is a signal, never a
          resolution.
        </p>
      </div>

      {(["asana", "linear"] as const).map((provider) => {
        const connected = data?.connections.find((candidate) => candidate.provider === provider);
        const configured = data?.oauthConfigured[provider] ?? false;
        const ready = configured && (data?.credentialReady ?? false);
        return (
          <div key={provider} style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{PROVIDER_LABEL[provider]}</strong>
                <p style={FIELD_HELP}>
                  {connected
                    ? `Connected to ${connected.workspaceName ?? connected.workspaceId ?? "a workspace"} by ${connected.installedBy}.`
                    : configured
                      ? "Not connected. Connecting is a project-admin action."
                      : `Not configured on this deployment. Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET.`}
                </p>
                {connected?.lastError ? (
                  <p style={{ ...FIELD_HELP, color: "var(--status-warning-text)" }}>{connected.lastError}</p>
                ) : null}
                {connected ? (
                  <p style={FIELD_HELP}>
                    Installed {new Date(connected.installedAt).toLocaleDateString()}
                    {connected.scopes.length > 0 ? ` · scopes: ${connected.scopes.join(", ")}` : ""}
                  </p>
                ) : null}
              </div>
              {connected ? (
                <button
                  type="button"
                  style={ACTION_BUTTON}
                  disabled={disabled || busy}
                  onClick={() => void run(async () => {
                    await request(`/api/integrations/${provider}/disconnect`, {});
                    setNotice(`${PROVIDER_LABEL[provider]} disconnected. Its links were removed; the tasks were not.`);
                  })}
                >
                  Disconnect
                </button>
              ) : (
                <a
                  href={ready && !disabled ? pathFor(`/api/integrations/${provider}/oauth/start`) : undefined}
                  aria-disabled={!ready || disabled}
                  style={{
                    ...ACTION_BUTTON,
                    textDecoration: "none",
                    opacity: ready && !disabled ? 1 : 0.55,
                    pointerEvents: ready && !disabled ? "auto" : "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Connect {PROVIDER_LABEL[provider]}
                </a>
              )}
            </div>

            {connected ? (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "44ch" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Default destination</span>
                <select
                  value={connected.defaultDestinationId ?? ""}
                  disabled={disabled || busy}
                  onChange={(event) => void run(async () => {
                    await request(`/api/integrations/${provider}/default-destination`, { destinationId: event.target.value });
                    setNotice("Default destination saved.");
                  })}
                  style={{ ...ACTION_BUTTON, width: "100%" }}
                >
                  <option value="" disabled>
                    Choose a destination
                  </option>
                  {(availableDestinations.length > 0 ? availableDestinations : connected.defaultDestinationId
                    ? [{ id: connected.defaultDestinationId, name: connected.defaultDestinationName ?? connected.defaultDestinationId, workspaceId: connected.workspaceId ?? "", workspaceName: connected.workspaceName }]
                    : []).map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.workspaceName ? `${destination.workspaceName} · ` : ""}{destination.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        );
      })}

      {settings ? (
        <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Automations</strong>
          <p style={FIELD_HELP}>Four switches, not a rule builder. Each is off until you turn it on.</p>
          {AUTOMATION_ROWS.map((row) => (
            <label key={row.key} style={{ display: "flex", gap: 9, alignItems: "flex-start", maxWidth: "62ch" }}>
              <input
                type="checkbox"
                checked={settings.automations[row.key]}
                disabled={disabled || busy}
                onChange={(event) => toggle(row.key, event.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 12.5, color: "var(--text-body)" }}>{row.label}</span>
                <span style={FIELD_HELP}>{row.help}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <strong style={{ fontSize: 13 }}>Outbound events</strong>
        <p style={FIELD_HELP}>
          A signed HTTPS POST for Zapier, Make or n8n. Each delivery carries <code>x-pagewatch-signature</code>, an HMAC
          of the body with the secret below. V1 sends events out; it accepts none.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: "56ch" }}>
          <input
            type="url"
            aria-label="Outbound event endpoint"
            placeholder="https://hooks.example.com/page-watch"
            value={webhookDraft}
            disabled={disabled || busy}
            onChange={(event) => setWebhookDraft(event.target.value)}
            style={{ ...ACTION_BUTTON, flex: "1 1 auto", cursor: "text" }}
          />
          <button
            type="button"
            style={ACTION_BUTTON}
            disabled={disabled || busy || webhookDraft === (settings?.webhookUrl ?? "")}
            onClick={() => void run(async () => {
              const result = await request<{ secret?: string }>("/api/integrations/webhook", { url: webhookDraft });
              setSyncDraft(webhookDraft);
              if (result.secret) setWebhookSecret(result.secret);
              setNotice(webhookDraft ? "Endpoint saved." : "Endpoint removed.");
            })}
          >
            Save
          </button>
        </div>
        {settings?.webhookConfigured ? <p style={FIELD_HELP}>An endpoint is configured.</p> : null}
        {webhookSecret ? (
          <p style={{ ...FIELD_HELP, wordBreak: "break-all" }}>
            Signing secret, shown once: <code>{webhookSecret}</code>
          </p>
        ) : null}
      </div>

      <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <strong style={{ fontSize: 13 }}>Automation token</strong>
        <p style={FIELD_HELP}>
          Read-only access to this project&apos;s task links, for an external automation that needs to reconcile its
          records. It cannot create, close or comment on a task.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {settings?.apiTokenPrefix ? (
            <>
              <code style={{ fontSize: 12 }}>{settings.apiTokenPrefix}…</code>
              <button
                type="button"
                style={ACTION_BUTTON}
                disabled={disabled || busy}
                onClick={() => void run(async () => {
                  await request("/api/integrations/api-token", undefined, "DELETE");
                  setIssuedToken(null);
                  setNotice("Token revoked.");
                })}
              >
                Revoke
              </button>
            </>
          ) : (
            <button
              type="button"
              style={ACTION_BUTTON}
              disabled={disabled || busy}
              onClick={() => void run(async () => {
                const result = await request<{ token: string }>("/api/integrations/api-token", {});
                setIssuedToken(result.token);
              })}
            >
              Issue token
            </button>
          )}
        </div>
        {issuedToken ? (
          <p style={{ ...FIELD_HELP, wordBreak: "break-all" }}>
            Token, shown once: <code>{issuedToken}</code>
          </p>
        ) : null}
      </div>

      {notice ? <p role="status" aria-live="polite" style={FIELD_HELP}>{notice}</p> : null}
      {failure ? <p role="status" aria-live="polite" style={{ ...FIELD_HELP, color: "var(--status-warning-text)" }}>{failure}</p> : null}
      {error ? <p style={{ ...FIELD_HELP, color: "var(--status-warning-text)" }}>{error}</p> : null}
    </div>
  );
}
