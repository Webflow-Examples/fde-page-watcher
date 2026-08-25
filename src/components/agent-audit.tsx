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
import { Magnitude } from "@/components/magnitude";

/**
 * The four health bands, as names. Nothing in this file names a colour value:
 * a band resolves to `var(--health-<band>-text|-bg|-border)` at the one place
 * that paints it, `<ResultBadge>` below.
 */
type HealthBand = "good" | "warn" | "poor" | "none";

/**
 * Is this check in good shape right now? That is a health question, so a
 * provider result gets a health band.
 *
 * `not-applicable` and `unavailable` are deliberately `none`, not `warn`.
 * Neither says anything is wrong — one says the check does not apply and the
 * other says the provider could not reach an answer. Both are the absence of a
 * verdict, which is what `none` means, and neither may look like a pass.
 *
 * These five values are the provider's, not ours: they are not F1 work states,
 * so this badge is not a `<StatusChip>`.
 */
function resultTone(result: ExternalAgentCheckResult): HealthBand {
  if (result === "pass") return "good";
  if (result === "failed") return "poor";
  if (result === "partial") return "warn";
  return "none";
}

/** A result carries meaning, so it never renders below 12px. */
const RESULT_BADGE_FONT_SIZE = 12;

function ResultBadge({ result }: { result: ExternalAgentCheckResult }) {
  const band = resultTone(result);
  return (
    <span
      data-health-band={band}
      style={{
        flex: "none",
        fontSize: RESULT_BADGE_FONT_SIZE,
        fontWeight: 600,
        lineHeight: 1.35,
        color: `var(--health-${band}-text)`,
        background: `var(--health-${band}-bg)`,
        border: `1px solid var(--health-${band}-border)`,
        borderRadius: 5,
        padding: "1px 7px",
        whiteSpace: "nowrap",
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
    <li style={{ listStyle: "none", padding: "10px 0", borderTop: "1px solid var(--border-hairline)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{finding.name}</div>
        <ResultBadge result={finding.result} />
      </div>
      {/* A tier is a classification, not a verdict: it says which bucket the
          check sits in, not whether the page is doing well. No hue. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {tier && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{tier}</span>}
        {finding.bonus && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Upside only</span>}
      </div>
      {finding.details && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.5 }}>{finding.details}</div>
      )}
      {/* Provider evidence, not a Page Watch guarantee of impact. */}
      {finding.result === "not-applicable" && finding.applicability && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.5 }}>
          Provider marked this not applicable: {finding.applicability}
        </div>
      )}
      {finding.recommendation && finding.result !== "pass" && finding.result !== "not-applicable" && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.5 }}>
          {/* Label and body were two greys that now resolve to the same token,
              so the label leans on weight instead of a second ink. */}
          <span style={{ fontWeight: 600 }}>Provider suggests: </span>
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
      style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border-hairline)" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div id="external-agent-audit-panel-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>
            External agent audit
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>
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
              border: "1px solid var(--border-hairline)",
              background: "transparent",
              color: "var(--text-muted)",
              /* The two greys this used to switch between are one token now, so
                 the in-flight state is carried by dimming rather than by a hue
                 difference that no longer exists. */
              opacity: refreshing ? 0.55 : 1,
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
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>
          This page&apos;s domain cannot be audited externally. External audits run against published
          production origins; Webflow staging domains are never sent to the provider.
        </div>
      )}

      {supported && !enabled && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>
          Not enabled for this project. An external audit sends this page&apos;s production origin to Ora,
          and Ora scans are public. Turn it on in Watch List settings.
        </div>
      )}

      {supported && enabled && !reading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>
          No external audit has been stored for this origin yet.
        </div>
      )}

      {supported && enabled && reading && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 14, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Is Agentic essentials</div>
              {/*
                The score answers "how much", so it carries weight, not hue. It
                must not borrow a health colour from the provider's band copy
                below it — that copy is the provider's verdict, not ours.
              */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 2 }}>
                {reading.essentialsScore === null ? (
                  <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.4, color: "var(--health-none-text)" }}>
                    —
                  </span>
                ) : (
                  <Magnitude
                    value={reading.essentialsScore}
                    unit="/ 100"
                    fontSize={24}
                    style={{ letterSpacing: -0.4 }}
                  />
                )}
              </div>
              {/* Provider-owned band copy, rendered verbatim. */}
              {reading.essentialsLabel && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{reading.essentialsLabel}</div>
              )}
              {reading.essentialsScore === null && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  Too few checks applied to score this origin.
                </div>
              )}
            </div>
            {/*
              Five counts that used to run together as prose in two shades of
              grey. They are quantities, so each numeral takes weight and its
              trailing noun takes the unit token; the badges above keep the only
              health hue on the card.
            */}
            {reading.counts && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: 12,
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                <Magnitude value={reading.counts.failed} unit="failing" fontSize={12} />
                <Magnitude value={reading.counts.partial} unit="partial" fontSize={12} />
                <Magnitude value={reading.counts.pass} unit="passing" fontSize={12} />
                <Magnitude value={reading.counts.notApplicable} unit="not applicable" fontSize={12} />
                <Magnitude value={reading.counts.unavailable} unit="not determined" fontSize={12} />
              </div>
            )}
          </div>

          {/*
            Staleness and an unfinished scan describe how much this evidence can
            be trusted, not whether the page is healthy. They read as weak
            confidence, never as an amber warning about the site itself.
          */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 12,
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            <span>{reading.ageLabel}</span>
            {reading.stale && <span style={{ color: "var(--confidence-weak)" }}>Older than a day</span>}
            {reading.partial && (
              <span style={{ color: "var(--confidence-weak)" }}>Provider had not finished every check</span>
            )}
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
                  color: "var(--action-primary-ink)",
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
            <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>Advanced evidence</summary>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.7 }}>
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
                    style={{ color: "var(--action-primary-ink)" }}
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
