"use client";

import { useState } from "react";
import { latestExternalAgentSnapshot, type ExternalAgentFinding, type ExternalAgentOriginAudit } from "@/lib/agentAudit";
import {
  externalAgentResultLabel,
  externalAgentSourceReading,
  externalAgentStatusLabel,
  orderedExternalFindings,
  pageSupportsExternalAudit,
} from "@/lib/externalAgentEvidence";
import type { ExternalAgentCheckResult } from "@/lib/agentAudit";
import { C } from "@/lib/ui";

function resultTone(result: ExternalAgentCheckResult): { color: string; background: string } {
  if (result === "pass") return { color: C.green, background: "rgba(53,208,127,0.13)" };
  if (result === "failed") return { color: C.redSoft, background: "rgba(255,92,108,0.13)" };
  if (result === "partial") return { color: C.amber, background: "rgba(255,154,61,0.13)" };
  // Not applicable and not determined are both muted, but never look like a pass.
  return { color: C.muted, background: "rgba(255,255,255,0.06)" };
}

function ResultBadge({ result }: { result: ExternalAgentCheckResult }) {
  const tone = resultTone(result);
  return (
    <span
      style={{
        flex: "none",
        fontSize: 11,
        fontWeight: 600,
        color: tone.color,
        background: tone.background,
        borderRadius: 5,
        padding: "2px 7px",
      }}
    >
      {externalAgentResultLabel(result)}
    </span>
  );
}

function tierLabel(finding: ExternalAgentFinding): string | null {
  if (finding.tier === "essential") return "Essential";
  if (finding.tier === "recommended") return "Recommended";
  if (finding.tier === "emerging") return "Forward-looking";
  return null;
}

function FindingRow({ finding }: { finding: ExternalAgentFinding }) {
  const tier = tierLabel(finding);
  return (
    <li style={{ listStyle: "none", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{finding.name}</div>
        <ResultBadge result={finding.result} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {tier && <span style={{ fontSize: 11, color: C.faint }}>{tier}</span>}
        {finding.bonus && <span style={{ fontSize: 11, color: C.faint }}>Upside only</span>}
      </div>
      {finding.details && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>{finding.details}</div>
      )}
      {/* Provider evidence, not a Page Watch guarantee of impact. */}
      {finding.result === "not-applicable" && finding.applicability && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 5, lineHeight: 1.5 }}>
          Provider marked this not applicable: {finding.applicability}
        </div>
      )}
      {finding.recommendation && finding.result !== "pass" && finding.result !== "not-applicable" && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
          <span style={{ color: C.faint }}>Provider suggests: </span>
          {finding.recommendation}
        </div>
      )}
    </li>
  );
}

/**
 * External agent-audit source card.
 *
 * Shows the website-focused essentials reading as the headline and keeps the
 * provider's own score, grade, and report link in advanced evidence — the two
 * are different scales and must not be read as one number. Neither is combined
 * with the Page Watch check percentage shown elsewhere on this tab.
 */
export function ExternalAgentAuditPanel({
  audit,
  pageUrl,
  enabled,
  canManage,
  refreshing,
  onRefresh,
}: {
  audit: ExternalAgentOriginAudit | null;
  pageUrl: string;
  enabled: boolean;
  canManage: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [showFindings, setShowFindings] = useState(false);
  const reading = externalAgentSourceReading(audit);
  const snapshot = audit ? latestExternalAgentSnapshot(audit) : null;
  const supported = pageSupportsExternalAudit(pageUrl);

  return (
    <section
      aria-labelledby="external-agent-audit-panel-heading"
      style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.border}` }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div id="external-agent-audit-panel-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>
            External agent audit
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, lineHeight: 1.5 }}>
            Independent origin-level audit from Ora, the scanner behind Is Agentic. Separate from the Page
            Watch checks above — the two are not combined.
          </div>
        </div>
        {enabled && supported && canManage && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            style={{
              flex: "none",
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: refreshing ? C.faint : C.muted,
              fontSize: 12,
              fontWeight: 600,
              padding: "7px 11px",
              borderRadius: 7,
              cursor: refreshing ? "default" : "pointer",
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh audit"}
          </button>
        )}
      </div>

      {!supported && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.5 }}>
          This page&apos;s domain cannot be audited externally. External audits run against published
          production origins; Webflow staging domains are never sent to the provider.
        </div>
      )}

      {supported && !enabled && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.5 }}>
          Not enabled for this project. An external audit sends this page&apos;s production origin to Ora,
          and Ora scans are public. Turn it on in Watch List settings.
        </div>
      )}

      {supported && enabled && !reading && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.5 }}>
          No external audit has been stored for this origin yet.
        </div>
      )}

      {supported && enabled && reading && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 14, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: C.faint, fontWeight: 600 }}>Is Agentic essentials</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 2 }}>
                <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4 }}>
                  {reading.essentialsScore === null ? "—" : reading.essentialsScore}
                </span>
                {reading.essentialsScore !== null && (
                  <span style={{ fontSize: 12, color: C.faint }}>/ 100</span>
                )}
              </div>
              {/* Provider-owned band copy, rendered verbatim. */}
              {reading.essentialsLabel && (
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{reading.essentialsLabel}</div>
              )}
              {reading.essentialsScore === null && (
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>
                  Too few checks applied to score this origin.
                </div>
              )}
            </div>
            {reading.counts && (
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
                <div>
                  {reading.counts.failed} failing · {reading.counts.partial} partial · {reading.counts.pass} passing
                </div>
                <div style={{ color: C.faint }}>
                  {reading.counts.notApplicable} not applicable · {reading.counts.unavailable} not determined
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12, fontSize: 11.5, color: C.faint }}>
            <span>{reading.ageLabel}</span>
            {reading.stale && <span style={{ color: C.amber }}>Older than a day</span>}
            {reading.partial && <span style={{ color: C.amber }}>Provider had not finished every check</span>}
            {audit?.status && <span>{externalAgentStatusLabel(audit.status.status)}</span>}
          </div>

          {snapshot && snapshot.findings.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowFindings((value) => !value)}
                aria-expanded={showFindings}
                style={{
                  border: "none",
                  background: "none",
                  color: C.accentSoft,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: 0,
                  marginTop: 14,
                  cursor: "pointer",
                }}
              >
                {showFindings ? "Hide provider findings" : `Show ${snapshot.findings.length} provider findings`}
              </button>
              {showFindings && (
                <ul style={{ margin: "10px 0 0", padding: 0 }}>
                  {orderedExternalFindings(snapshot).map((finding, index) => (
                    <FindingRow
                      key={`${finding.providerCheckId}:${index}`}
                      finding={finding}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          <details style={{ marginTop: 14 }}>
            <summary style={{ fontSize: 12, color: C.muted, cursor: "pointer" }}>Advanced evidence</summary>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.7 }}>
              <div>
                Ora full score:{" "}
                {reading.providerScore === null
                  ? "not evaluated"
                  : `${reading.providerScore} / 100${reading.providerGrade ? ` (${reading.providerGrade})` : ""}`}
              </div>
              <div>
                A different scale from the essentials reading above, and from the Page Watch check
                percentage. They are shown separately on purpose and are never averaged.
              </div>
              {audit?.origin && <div>Audited origin: {audit.origin}</div>}
              {reading.contractVersion && <div>Provider contract: {reading.contractVersion}</div>}
              {reading.reportUrl && (
                <div>
                  <a
                    href={reading.reportUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ color: C.accentSoft }}
                  >
                    Open the provider report
                  </a>
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
