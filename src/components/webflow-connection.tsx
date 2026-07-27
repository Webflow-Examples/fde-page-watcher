"use client";

import { useCallback, useEffect, useState } from "react";
import { C } from "@/lib/ui";
import type { WebflowConnectionStatus } from "@/lib/webflowTypes";

function timestamp(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as T | { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(
      value && typeof value === "object" && "error" in value && typeof value.error === "string"
        ? value.error
        : `Request failed with status ${response.status}`,
    );
  }
  return value as T;
}

export function WebflowConnection({ connectionUrl }: { connectionUrl: string }) {
  const [status, setStatus] = useState<WebflowConnectionStatus | null>(null);
  const [siteId, setSiteId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(connectionUrl, { cache: "no-store" });
      setStatus(await responseJson<WebflowConnectionStatus>(response));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Webflow connection");
      setStatus({ connected: false });
    }
  }, [connectionUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("connect");
    setError(null);
    try {
      const response = await fetch(connectionUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId, token }),
      });
      const next = await responseJson<WebflowConnectionStatus>(response);
      setStatus(next);
      setToken("");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect Webflow");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setError(null);
    try {
      await responseJson(await fetch(`${connectionUrl}/sync`, { method: "POST" }));
      await loadStatus();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Could not sync Webflow activity");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect this Webflow site? Imported activity evidence will be retained.")) return;
    setBusy("disconnect");
    setError(null);
    try {
      setStatus(await responseJson<WebflowConnectionStatus>(
        await fetch(connectionUrl, { method: "DELETE" }),
      ));
      setSiteId("");
      setToken("");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect Webflow");
    } finally {
      setBusy(null);
    }
  };

  const connected = status?.connected ? status : null;
  const syncTone = connected?.syncStatus === "failed"
    ? C.redSoft
    : connected?.syncStatus === "succeeded" ? C.green : C.amber;

  return (
    <section
      aria-labelledby="webflow-connection-heading"
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
        <div>
          <div id="webflow-connection-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>
            Webflow activity
          </div>
          <div style={{ maxWidth: 720, marginTop: 4, color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
            Connect one Enterprise site to retain named activity evidence and prepare automatic post-publish verification.
            The site token is encrypted by the collector and is never returned to this app.
          </div>
        </div>
        {connected && (
          <span
            style={{
              flex: "none",
              padding: "5px 9px",
              borderRadius: 6,
              background: "rgba(65,190,122,0.12)",
              color: C.green,
              fontSize: 11.5,
              fontWeight: 650,
            }}
          >
            Connected
          </span>
        )}
      </div>

      {status === null ? (
        <div style={{ padding: "24px 0 4px", color: C.muted, fontSize: 12 }}>Checking connection…</div>
      ) : connected ? (
        <div style={{ marginTop: 18 }}>
          <div
            className="webflow-connection-summary"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px,1.4fr) repeat(3,minmax(135px,1fr))",
              gap: 1,
              overflow: "hidden",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              background: C.border,
            }}
          >
            {[
              ["Site", connected.displayName],
              ["Activity events", String(connected.activityEventCount)],
              ["Last publish", timestamp(connected.lastPublished)],
              ["Last sync", timestamp(connected.lastSyncedAt)],
            ].map(([label, value]) => (
              <div key={label} style={{ minWidth: 0, padding: "13px 14px", background: C.bgElev }}>
                <div style={{ color: C.faint, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.045em" }}>{label}</div>
                <div style={{ marginTop: 5, overflow: "hidden", color: C.text, fontSize: 12.5, fontWeight: 600, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="webflow-connection-detail-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12, marginTop: 12 }}>
            <div style={{ padding: "13px 14px", border: `1px solid ${C.border}`, borderRadius: 10, background: "rgba(255,255,255,0.018)" }}>
              <div style={{ color: C.faint, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.045em" }}>Latest publish evidence</div>
              {connected.latestPublish ? (
                <>
                  <div style={{ marginTop: 6, color: C.text, fontSize: 12.5, fontWeight: 600 }}>
                    {connected.latestPublish.changeDensity.replace("-", " ")} · {connected.latestPublish.changeCount} changes
                  </div>
                  <div style={{ marginTop: 4, color: C.muted, fontSize: 11.5, lineHeight: 1.5 }}>
                    {connected.latestPublish.publisherName ?? "Publisher not available"}
                    {` · ${connected.latestPublish.pageCount} affected pages`}
                    {` · ${timestamp(connected.latestPublish.publishedAt)}`}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 6, color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
                  A change set will appear after the next detected publish.
                </div>
              )}
            </div>
            <div style={{ padding: "13px 14px", border: `1px solid ${C.border}`, borderRadius: 10, background: "rgba(255,255,255,0.018)" }}>
              <div style={{ color: C.faint, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.045em" }}>Latest activity</div>
              {connected.latestActivity ? (
                <>
                  <div style={{ marginTop: 6, color: C.text, fontSize: 12.5, fontWeight: 600 }}>
                    {connected.latestActivity.event.replaceAll("_", " ")}
                    {connected.latestActivity.operation ? ` · ${connected.latestActivity.operation.toLowerCase()}` : ""}
                  </div>
                  <div style={{ marginTop: 4, color: C.muted, fontSize: 11.5 }}>
                    {connected.latestActivity.actorName ?? "Unknown actor"}
                    {connected.latestActivity.resourceName ? ` · ${connected.latestActivity.resourceName}` : ""}
                    {` · ${timestamp(connected.latestActivity.createdOn)}`}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 6, color: C.muted, fontSize: 12 }}>No activity has been imported yet.</div>
              )}
            </div>
            <div style={{ padding: "13px 14px", border: `1px solid ${C.border}`, borderRadius: 10, background: "rgba(255,255,255,0.018)" }}>
              <div style={{ color: C.faint, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.045em" }}>Connection details</div>
              <div style={{ marginTop: 6, color: C.muted, fontSize: 11.5, lineHeight: 1.55 }}>
                <div>Site ID · <span style={{ color: C.dim }}>{connected.siteId}</span></div>
                <div>Timezone · <span style={{ color: C.dim }}>{connected.timeZone}</span></div>
                <div>Sync · <span style={{ color: syncTone, fontWeight: 600 }}>{connected.syncStatus}</span></div>
              </div>
            </div>
          </div>

          {connected.syncError && (
            <div style={{ marginTop: 10, color: C.redSoft, fontSize: 11.5 }}>
              Last sync failed: {connected.syncError}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 14 }}>
            <div style={{ color: C.faint, fontSize: 11.5 }}>
              Activity sync also runs automatically with the collector&apos;s 15-minute schedule.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={disconnect}
                style={{ border: `1px solid ${C.border2}`, background: "transparent", color: C.redSoft, fontSize: 12, fontWeight: 550, padding: "8px 11px", borderRadius: 7, cursor: "pointer" }}
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={sync}
                style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 7, cursor: "pointer" }}
              >
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form className="webflow-connection-form" onSubmit={connect} style={{ display: "grid", gridTemplateColumns: "minmax(220px,0.65fr) minmax(300px,1fr) auto", alignItems: "end", gap: 12, marginTop: 18 }}>
          <label style={{ display: "grid", gap: 7, color: C.muted, fontSize: 11.5 }}>
            Webflow Site ID
            <input
              value={siteId}
              required
              minLength={24}
              maxLength={24}
              pattern="[A-Fa-f0-9]{24}"
              placeholder="24-character site ID"
              onChange={(event) => setSiteId(event.target.value)}
              style={{ background: C.bgElev, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "9px 10px", fontSize: 13 }}
            />
          </label>
          <label style={{ display: "grid", gap: 7, color: C.muted, fontSize: 11.5 }}>
            Site token
            <input
              type="password"
              value={token}
              required
              minLength={20}
              maxLength={2048}
              autoComplete="off"
              placeholder="Token with site activity, sites, pages, assets, and CMS read access"
              onChange={(event) => setToken(event.target.value)}
              style={{ background: C.bgElev, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "9px 10px", fontSize: 13 }}
            />
          </label>
          <button
            type="submit"
            disabled={busy !== null}
            style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600, padding: "10px 13px", borderRadius: 7, cursor: "pointer" }}
          >
            {busy === "connect" ? "Connecting…" : "Connect Webflow"}
          </button>
        </form>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 11, color: C.redSoft, fontSize: 11.5 }}>
          {error}
        </div>
      )}
    </section>
  );
}
