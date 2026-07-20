"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import { CATEGORIES } from "@/lib/types";
import type { CategoryKey, Night, Rec, WatchPage } from "@/lib/types";
import { categorySeries, deltaMeta, scoreMeta } from "@/lib/scoring";
import { auditsFor } from "@/lib/audits";
import { C, taskLabel } from "@/lib/ui";
import { HistoryChart, Sparkline } from "@/components/charts";
import { SegToggle, StatusBadge } from "@/components/bits";
import { ChevronLeftIcon, DesktopIcon, MobileIcon, PlusIcon, RefreshIcon } from "@/components/icons";

export default function PageDetail() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { pages, recs, strategy, setStrategy, tab, setTab, chartCat, setChartCat } = store;
  const page = pages.find((p) => p.id === id);

  useEffect(() => {
    setTab("overview");
    setChartCat("perf");
  }, [id, setTab, setChartCat]);

  if (!page) {
    return (
      <div style={{ padding: 40 }}>
        <button onClick={() => router.push("/dashboard")} style={{ border: "none", background: "none", color: C.muted, cursor: "pointer", fontSize: 13 }}>← Back to dashboard</button>
        <p style={{ color: C.muted, marginTop: 16 }}>Page not found. It may have been removed from the watchlist.</p>
      </div>
    );
  }

  // Unavailable checks (scan couldn't reach the page, REQ-033) are neither
  // passing nor failing — exclude them from the pass rate and the fail list
  // instead of counting them as red failures (audit).
  const available = page.agent.filter((c) => !c.unavailable);
  const unavailableCount = page.agent.length - available.length;
  const pass = available.filter((c) => c.pass).length;
  const total = available.length;
  const apct = total ? Math.round((pass / total) * 100) : 0;
  const apm = scoreMeta(apct);
  const failList = available.filter((c) => !c.pass);
  const isPending = page.status === "pending" || page.history.length === 0;

  const tabs: { key: "overview" | "history" | "audits" | "agent"; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "history", label: "History" },
    { key: "audits", label: "Opportunities" },
    { key: "agent", label: "Agent-readiness" },
  ];

  return (
    <div>
      <header style={{ padding: "22px 40px 0", borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => router.push("/dashboard")} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "none", fontSize: 12.5, color: C.muted, cursor: "pointer", padding: "0 0 14px" }}>
          <ChevronLeftIcon size={14} />
          Page performance
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, paddingBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <h1 style={{ margin: 0, fontSize: 25, fontWeight: 600, letterSpacing: "-0.01em" }}>{page.title}</h1>
              <StatusBadge status={page.status} />
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 7 }}>{page.url}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SegToggle value={strategy} onChange={setStrategy} options={[{ value: "mobile", label: "Mobile", icon: <MobileIcon size={13} /> }, { value: "desktop", label: "Desktop", icon: <DesktopIcon size={13} /> }]} />
            <button onClick={() => store.runPage(page.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 15px", border: "none", borderRadius: 8, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 550, cursor: "pointer", whiteSpace: "nowrap" }}>
              <RefreshIcon size={15} style={{ color: "#fff" }} />
              Run now
            </button>
            <button onClick={() => store.openMarker(page.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 15px", border: `1px solid ${C.border2}`, borderRadius: 8, background: "rgba(255,255,255,0.04)", color: C.text, fontSize: 12.5, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
              <PlusIcon size={15} style={{ color: C.text }} />
              Log change marker
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ border: "none", background: "none", fontSize: 13.5, fontWeight: 500, padding: "11px 4px", marginRight: 24, cursor: "pointer", color: tab === t.key ? "#FFFFFF" : C.muted, borderBottom: `2px solid ${tab === t.key ? C.accentBright : "transparent"}` }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div style={{ padding: "28px 40px 56px" }}>
        {isPending ? (
          <PendingPanel page={page} store={store} />
        ) : (
          <>
            {tab === "overview" && <OverviewTab page={page} recs={recs} strategy={strategy} apct={apct} apm={apm} pass={pass} total={total} failList={failList} store={store} />}
            {tab === "history" && <HistoryTab page={page} strategy={strategy} chartCat={chartCat} setChartCat={setChartCat} store={store} />}
            {tab === "audits" && <OpportunitiesTab />}
            {tab === "agent" && <AgentTab page={page} pass={pass} fail={total - pass} unavailable={unavailableCount} />}
          </>
        )}
      </div>
    </div>
  );
}

function OverviewTab({
  page,
  recs,
  strategy,
  apct,
  apm,
  pass,
  total,
  failList,
  store,
}: {
  page: WatchPage;
  recs: Rec[];
  strategy: "mobile" | "desktop";
  apct: number;
  apm: { fg: string; ring: string };
  pass: number;
  total: number;
  failList: { name: string }[];
  store: ReturnType<typeof useStore>;
}) {
  const last = page.history[page.history.length - 1];
  const pageRecs = recs.filter((r) => r.pageId === page.id);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 20 }}>
        {CATEGORIES.map((c) => {
          const v = page.current[strategy][c.key];
          const bv = page.baseline[strategy][c.key].m;
          const sm = scoreMeta(v);
          const dm = deltaMeta(v, bv);
          const night = last.scores[strategy][c.key];
          return (
            <div key={c.key} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "18px 19px 8px" }}>
              <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>{c.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, color: sm.fg }}>{v}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, color: dm.fg, background: dm.chip }}>{dm.text}</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 7 }}>Baseline {bv} · ± {night.hi - night.lo} range</div>
              <div style={{ height: 52, marginTop: 6 }}>
                <Sparkline series={categorySeries(page.history, strategy, c.key, 30)} color={sm.line} h={52} sw={2} w={200} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: 22, marginBottom: 20, display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", border: `4px solid ${total ? apm.ring : C.border2}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600, color: total ? apm.fg : C.muted }}>
            {total ? `${apct}%` : "—"}
          </div>
          <div style={{ lineHeight: 1.45 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Agent-readiness</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>{total ? `${pass} of ${total} checks passing` : "No scan yet"}</div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>Pass rate, computed live from per-check results — not a composite score</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${C.border}`, paddingLeft: 26 }}>
          {failList.length === 0 ? (
            <div style={{ fontSize: 13, color: C.green, fontWeight: 500 }}>{total ? "All tracked checks passing." : "Run a scan to see per-check results."}</div>
          ) : (
            <div>
              <div style={{ fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 11 }}>Failing checks</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {failList.map((f) => (
                  <span key={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.redSoft, background: "rgba(255,92,108,0.13)", padding: "5px 11px", borderRadius: 7 }}>
                    <span style={{ width: 15, height: 15, borderRadius: 4, background: C.red, color: C.bg, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</span>
                    {f.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Recommendations for this page</h3>
          <span style={{ fontSize: 12, color: C.faint }}>Lighthouse estimated savings</span>
        </div>
        {pageRecs.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 16, padding: "15px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.title}</div>
              <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{r.category}</div>
              {r.aiSummary && <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{r.aiSummary}</div>}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.amber, whiteSpace: "nowrap" }}>{r.savings}</div>
            {r.status === "inbox" ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => store.saveTask(r.key)} style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 550, padding: "7px 12px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>Save as task</button>
                <button onClick={() => store.ignoreRec(r.key)} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.dim, fontSize: 12, fontWeight: 500, padding: "7px 12px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>Ignore</button>
              </div>
            ) : (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 550,
                  padding: "6px 12px",
                  borderRadius: 7,
                  whiteSpace: "nowrap",
                  color: r.status === "task" ? C.accentSoft : C.muted,
                  background: r.status === "task" ? "rgba(59,137,255,0.14)" : "rgba(255,255,255,0.06)",
                }}
              >
                {r.status === "task" ? `In tasks · ${taskLabel(r.taskStatus)}` : "Ignored"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryTab({
  page,
  strategy,
  chartCat,
  setChartCat,
  store,
}: {
  page: WatchPage;
  strategy: "mobile" | "desktop";
  chartCat: CategoryKey;
  setChartCat: (c: CategoryKey) => void;
  store: ReturnType<typeof useStore>;
}) {
  const runs = [...page.history].reverse().slice(0, 12);
  const GRID = "120px 1fr 84px 84px 84px 84px 100px";
  const openReport = async (d: Night) => {
    const cats = CATEGORIES.map((c) => {
      const s = d.scores[strategy][c.key];
      return { label: c.label, median: s.m, range: `${s.lo}–${s.hi}`, key: c.key };
    });
    // Read the actual stored object for this night, not a fabricated payload
    // (audit: audit trail). Seed / imported nights have no stored report, so
    // show an honest summary of what IS stored instead of inventing PSI metadata.
    let raw: string;
    if (d.rawReportKey) {
      try {
        const res = await fetch(`/api/pages/${page.id}/report/${encodeURIComponent(d.rawReportKey)}`);
        if (res.ok) {
          const json = (await res.json()) as { report: unknown };
          raw = JSON.stringify(json.report, null, 2);
        } else {
          raw = fallbackReport(d);
        }
      } catch {
        raw = fallbackReport(d);
      }
    } else {
      raw = fallbackReport(d);
    }
    store.openReport({ date: d.date, url: page.url, raw, cats });
  };

  function fallbackReport(d: Night): string {
    return JSON.stringify(
      {
        note: "No raw PSI payload is stored for this night (seed / imported data). Showing the stored medians and ranges only.",
        date: d.date,
        strategy,
        samples: d.samples ?? d.sampleSize ?? null,
        scores: {
          performance: { median: d.scores[strategy].perf.m, range: [d.scores[strategy].perf.lo, d.scores[strategy].perf.hi] },
          accessibility: { median: d.scores[strategy].a11y.m, range: [d.scores[strategy].a11y.lo, d.scores[strategy].a11y.hi] },
          "best-practices": { median: d.scores[strategy].bp.m, range: [d.scores[strategy].bp.lo, d.scores[strategy].bp.hi] },
          seo: { median: d.scores[strategy].seo.m, range: [d.scores[strategy].seo.lo, d.scores[strategy].seo.hi] },
        },
        agentChecksRecorded: d.agent?.length ?? 0,
      },
      null,
      2,
    );
  }

  return (
    <div>
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: 22, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Score over time · {page.history.length} nights</h3>
          <SegToggle value={chartCat} onChange={setChartCat} options={CATEGORIES.map((c) => ({ value: c.key, label: c.short }))} />
        </div>
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 16 }}>Median line with the run-to-run range shaded; dashed line is the baseline; vertical markers are logged changes.</div>
        <HistoryChart history={page.history} strategy={strategy} catKey={chartCat} baseline={page.baseline[strategy][chartCat].m} markers={page.markers} />
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "14px 22px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>
          <div>Night</div>
          <div>Marker</div>
          <div style={{ textAlign: "center" }}>Perf</div>
          <div style={{ textAlign: "center" }}>A11y</div>
          <div style={{ textAlign: "center" }}>BP</div>
          <div style={{ textAlign: "center" }}>SEO</div>
          <div />
        </div>
        {runs.map((d) => {
          const mk = page.markers.find((m) => m.i === d.i);
          const cell = (k: CategoryKey) => {
            const v = d.scores[strategy][k].m;
            return <div style={{ textAlign: "center", fontWeight: 600, color: scoreMeta(v).fg }}>{v}</div>;
          };
          return (
            <div key={d.i} style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "12px 22px", borderBottom: `1px solid ${C.rowBorder}`, fontSize: 13 }}>
              <div style={{ fontWeight: 500 }}>{d.date}</div>
              <div style={{ fontSize: 12, color: mk ? C.violetSoft : "#4A4A50", display: "flex", alignItems: "center", gap: 6 }}>{mk ? `◆ ${mk.text}` : "—"}</div>
              {cell("perf")}
              {cell("a11y")}
              {cell("bp")}
              {cell("seo")}
              <div style={{ textAlign: "right" }}>
                <button onClick={() => openReport(d)} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.text, fontSize: 11.5, fontWeight: 500, padding: "5px 11px", borderRadius: 7, cursor: "pointer" }}>Report</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PendingPanel({ page, store }: { page: WatchPage; store: ReturnType<typeof useStore> }) {
  return (
    <div style={{ padding: "56px 24px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>No data yet</div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 8, maxWidth: 460, marginInline: "auto", lineHeight: 1.55 }}>
        This page is pending its first collection. Capture a baseline to anchor future comparisons, or run now to collect a first snapshot. It also joins the next nightly run automatically.
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
        <button onClick={() => store.captureBaseline(page.id)} style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 550, padding: "9px 16px", borderRadius: 8, cursor: "pointer" }}>Capture baseline</button>
        <button onClick={() => store.runPage(page.id)} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.04)", color: C.text, fontSize: 12.5, fontWeight: 500, padding: "9px 16px", borderRadius: 8, cursor: "pointer" }}>Run now</button>
      </div>
    </div>
  );
}

function OpportunitiesTab() {
  const audits = auditsFor();
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}` }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Failing audits &amp; opportunities</h3>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>Ordered by Lighthouse&apos;s estimated load-time savings.</div>
      </div>
      {audits.map((a, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "17px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
          <div style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", marginTop: 6, background: a.dot }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</div>
            <div style={{ fontSize: 12.5, color: C.faint2, marginTop: 4, lineHeight: 1.5 }}>{a.desc}</div>
            <span style={{ display: "inline-block", fontSize: 11, fontWeight: 500, color: C.dim, background: "rgba(255,255,255,0.06)", padding: "2px 9px", borderRadius: 5, marginTop: 9 }}>{a.category}</span>
          </div>
          <div style={{ flex: "none", textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.faint }}>Est. savings</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.amber }}>{a.savings}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentTab({ page, pass, fail, unavailable }: { page: WatchPage; pass: number; fail: number; unavailable: number }) {
  const groups = new Map<string, WatchPage["agent"]>();
  page.agent.forEach((c) => groups.set(c.group, [...(groups.get(c.group) ?? []), c]));
  const date = page.history[page.history.length - 1]?.date ?? "—";
  const allUnavailable = page.agent.length > 0 && unavailable === page.agent.length;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, padding: "15px 18px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 11 }}>
        <div style={{ fontSize: 13, color: C.faint2 }}>Recorded per check on {date} — pass/fail only, never a composite score.</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 12.5, fontWeight: 500 }}>
          <span style={{ color: C.green }}>{pass} passing</span>
          <span style={{ color: C.red }}>{fail} failing</span>
          {unavailable > 0 && <span style={{ color: C.muted }}>{unavailable} unavailable</span>}
        </div>
      </div>
      {page.agent.length === 0 ? (
        <div style={{ padding: "40px 22px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, color: C.muted, fontSize: 13 }}>
          No agent-readiness scan yet. Run one from the header.
        </div>
      ) : allUnavailable ? (
        <div style={{ padding: "40px 22px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, color: C.muted, fontSize: 13 }}>
          The last scan couldn&apos;t reach this page, so every check is unavailable — not failing. Try running again once the page is reachable.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, alignItems: "start" }}>
          {[...groups.entries()].map(([name, checks]) => (
            <div key={name} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "18px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 15 }}>{name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {checks.map((chk) => {
                  // Three states: pass (green ✓), fail (red ✕), unavailable (neutral –).
                  const mark = chk.unavailable ? "–" : chk.pass ? "✓" : "✕";
                  const markBg = chk.unavailable ? C.border2 : chk.pass ? C.green : C.red;
                  const markColor = chk.unavailable ? C.muted : C.bg;
                  const textColor = chk.unavailable ? C.faint : chk.pass ? C.dim : C.redSoft;
                  return (
                    <div key={chk.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: "none", width: 18, height: 18, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: markColor, background: markBg }}>{mark}</span>
                      <span style={{ fontSize: 13, color: textColor }}>{chk.name}</span>
                      {chk.unavailable ? (
                        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, color: C.muted, background: "rgba(255,255,255,0.06)", padding: "1px 7px", borderRadius: 4 }}>unavailable</span>
                      ) : (
                        chk.regressed && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, color: C.redSoft, background: "rgba(255,92,108,0.14)", padding: "1px 7px", borderRadius: 4 }}>regressed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
