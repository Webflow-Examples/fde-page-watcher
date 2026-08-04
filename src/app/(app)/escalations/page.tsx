"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import { SegToggle, WebflowClassificationChips } from "@/components/bits";
import { C } from "@/lib/ui";
import type { ProductEscalation, ProductEscalationStatus } from "@/lib/types";

type Filter = "open" | "resolved" | "all";

const STATUS_LABELS: Record<ProductEscalationStatus, string> = {
  draft: "Draft",
  ready: "Ready for review",
  submitted: "Submitted",
  resolved: "Resolved",
};

const STATUS_TONES: Record<ProductEscalationStatus, { color: string; background: string }> = {
  draft: { color: C.muted, background: "rgba(255,255,255,0.07)" },
  ready: { color: C.amber, background: "rgba(255,154,61,0.13)" },
  submitted: { color: C.accentSoft, background: "rgba(59,137,255,0.14)" },
  resolved: { color: C.green, background: "rgba(53,208,127,0.13)" },
};

function nextAction(status: ProductEscalationStatus): { label: string; status: ProductEscalationStatus } {
  if (status === "draft") return { label: "Mark ready", status: "ready" };
  if (status === "ready") return { label: "Mark submitted", status: "submitted" };
  if (status === "submitted") return { label: "Resolve", status: "resolved" };
  return { label: "Reopen", status: "draft" };
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : value;
}

function fieldTone(verdict: NonNullable<ProductEscalation["evidence"]["strategies"][number]["fieldEvidence"]>["verdict"]): { color: string; background: string } {
  if (verdict === "corroborated-issue") return { color: C.redSoft, background: "rgba(255,92,108,0.13)" };
  if (verdict === "field-only-risk" || verdict === "lab-only-risk") return { color: C.amber, background: "rgba(255,154,61,0.13)" };
  if (verdict === "aligned-good") return { color: C.green, background: "rgba(53,208,127,0.13)" };
  return { color: C.muted, background: "rgba(255,255,255,0.06)" };
}

function EscalationCard({ escalation }: { escalation: ProductEscalation }) {
  const router = useRouter();
  const { updateEscalation, pathFor } = useStore();
  const [owner, setOwner] = useState(escalation.owner);
  const [notes, setNotes] = useState(escalation.notes);
  const action = nextAction(escalation.status);
  const tone = STATUS_TONES[escalation.status];
  const evidenceCount = escalation.evidence.strategies.reduce((sum, item) => sum + item.culpritEvidence.length + Number(!!item.diagnostic) + Number(!!item.fieldEvidence), 0)
    + Number(!!escalation.evidence.nativeFinding);
  return (
    <article style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>{escalation.title}</h2>
            <span style={{ color: tone.color, background: tone.background, padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 650 }}>{STATUS_LABELS[escalation.status]}</span>
          </div>
          <button type="button" onClick={() => router.push(pathFor(`/pages/${escalation.pageId}?tab=opportunities`))} style={{ marginTop: 6, border: "none", padding: 0, background: "none", color: C.dim, fontSize: 11.5, cursor: "pointer" }}>{escalation.evidence.page.title} ↗</button>
          <div style={{ marginTop: 9 }}><WebflowClassificationChips classification={escalation.evidence.classification} /></div>
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: C.faint }}>Measured impact</div>
          <div style={{ marginTop: 2, fontSize: 17, fontWeight: 650, color: C.amber }}>{escalation.evidence.recommendation.impact}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 0.8fr) minmax(300px, 1.2fr)", gap: 20, padding: "18px 20px" }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.faint2 }}>Owner</label>
          <input value={owner} onChange={(event) => setOwner(event.target.value)} maxLength={100} placeholder="Assign a Product or Engineering owner" style={{ width: "100%", boxSizing: "border-box", marginTop: 6, border: `1px solid ${C.border2}`, background: C.panel2, color: C.text, borderRadius: 7, padding: "8px 10px", fontSize: 12 }} />
          <label style={{ display: "block", marginTop: 13, fontSize: 11, fontWeight: 600, color: C.faint2 }}>Escalation notes</label>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} rows={4} placeholder="Add reproduction context, customer impact, or a requested product capability." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", marginTop: 6, border: `1px solid ${C.border2}`, background: C.panel2, color: C.text, borderRadius: 7, padding: "9px 10px", fontSize: 12, lineHeight: 1.45 }} />
          <button type="button" onClick={() => updateEscalation(escalation.id, { owner, notes })} style={{ marginTop: 9, border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.04)", color: C.text, borderRadius: 7, padding: "7px 11px", fontSize: 11.5, cursor: "pointer" }}>Save details</button>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.faint2 }}>Evidence packet</div>
          <div style={{ marginTop: 6, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{escalation.evidence.classification.guidance}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {escalation.evidence.strategies.map((item) => (
              <span key={item.strategy} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                <span style={{ fontSize: 10.5, color: C.dim, background: "rgba(255,255,255,0.05)", padding: "3px 7px", borderRadius: 5, textTransform: "capitalize" }}>
                  {item.strategy} · Perf {item.performanceScore ?? "—"}{item.lifecycle ? ` · ${item.lifecycle.status}` : ""}
                </span>
                {item.fieldEvidence && (() => {
                  const field = fieldTone(item.fieldEvidence.verdict);
                  return <span title={`${item.fieldEvidence.metricLabel}: ${item.fieldEvidence.value ?? "unavailable"}`} style={{ fontSize: 10.5, fontWeight: 650, color: field.color, background: field.background, padding: "3px 7px", borderRadius: 5 }}>{item.fieldEvidence.verdictLabel}</span>;
                })()}
              </span>
            ))}
            <span style={{ fontSize: 10.5, color: C.accentSoft, background: "rgba(59,137,255,0.12)", padding: "3px 7px", borderRadius: 5 }}>{evidenceCount} evidence {evidenceCount === 1 ? "item" : "items"}</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 10.5, color: C.faint }}>Frozen {dateLabel(escalation.evidence.capturedAt)} · refresh before export if newer collections are relevant.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 15 }}>
            <a href={pathFor(`/api/escalations/${encodeURIComponent(escalation.id)}/export`)} style={{ textDecoration: "none", border: "none", background: C.accent, color: "#fff", borderRadius: 7, padding: "7px 11px", fontSize: 11.5, fontWeight: 550 }}>Download packet</a>
            <a href={pathFor(`/api/escalations/${encodeURIComponent(escalation.id)}/export?format=json`)} target="_blank" rel="noreferrer" style={{ textDecoration: "none", border: `1px solid ${C.border2}`, color: C.dim, borderRadius: 7, padding: "7px 11px", fontSize: 11.5 }}>View JSON</a>
            <button type="button" onClick={() => updateEscalation(escalation.id, { refreshEvidence: true })} style={{ border: `1px solid ${C.border2}`, background: "transparent", color: C.dim, borderRadius: 7, padding: "7px 11px", fontSize: 11.5, cursor: "pointer" }}>Refresh evidence</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 20px", borderTop: `1px solid ${C.border}`, background: C.panel2 }}>
        <span style={{ fontSize: 10.5, color: C.faint }}>Created {dateLabel(escalation.createdAt)}</span>
        {escalation.submittedAt && <span style={{ fontSize: 10.5, color: C.faint }}>· Submitted {dateLabel(escalation.submittedAt)}</span>}
        <button type="button" onClick={() => updateEscalation(escalation.id, { status: action.status, owner, notes })} style={{ marginLeft: "auto", border: "none", background: escalation.status === "resolved" ? "rgba(255,255,255,0.08)" : C.accent, color: "#fff", borderRadius: 7, padding: "7px 12px", fontSize: 11.5, fontWeight: 550, cursor: "pointer" }}>{action.label}</button>
      </div>
    </article>
  );
}

export default function EscalationsPage() {
  const { productEscalations = [] } = useStore();
  const [filter, setFilter] = useState<Filter>("open");
  const items = [...productEscalations]
    .filter((item) => filter === "all" || (filter === "resolved" ? item.status === "resolved" : item.status !== "resolved"))
    .sort((left, right) => Number(left.status === "resolved") - Number(right.status === "resolved") || right.updatedAt.localeCompare(left.updatedAt));
  const open = productEscalations.filter((item) => item.status !== "resolved").length;
  return (
    <div>
      <header className="page-header" style={{ padding: "30px 40px 24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Product escalations</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>Owned handoffs for performance issues that are blocked or only partially remediable in Webflow.</p>
        </div>
        <SegToggle label="Escalation filter" value={filter} onChange={setFilter} options={[{ value: "open", label: `Open (${open})` }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }]} />
      </header>
      <div className="page-content" style={{ padding: "0 40px 48px" }}>
        {items.length ? <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{items.map((item) => <EscalationCard key={item.id} escalation={item} />)}</div> : (
          <div style={{ padding: "70px 24px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{filter === "open" ? "No open product escalations" : "No escalations in this view"}</div>
            <div style={{ marginTop: 6, fontSize: 13, color: C.muted }}>Blocked and partial recommendations can be escalated directly from Inbox or a page&apos;s recommendations.</div>
          </div>
        )}
      </div>
    </div>
  );
}
