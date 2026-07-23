"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import { CATEGORIES } from "@/lib/types";
import type { AgentIgnoreSettings, CategoryKey, Night } from "@/lib/types";
import { summarizeAgentChecks } from "@/lib/agentScoring";
import { deltaMeta, historyForRange, pageRangeComparison, pageRangeSeries, pageRangeTrend, scoreMeta } from "@/lib/scoring";
import { buildWatcher } from "@/lib/watcher";
import { C, flagChip } from "@/lib/ui";
import { Sparkline } from "@/components/charts";
import { DeviceChangeLabels, SegToggle, SortHeader } from "@/components/bits";
import { DesktopIcon, MobileIcon } from "@/components/icons";
import { formatSuccessfulRunAt, lastSuccessfulRunAt, latestSuccessfulRunAt } from "@/lib/collectionStatus";
import { isPageActivelyMonitored } from "@/lib/watchCapacity";

const GRID = "minmax(170px,1fr) 142px 126px 126px 126px 126px 120px";

function agentSeries(
  history: Night[],
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): number[] {
  return history.slice(-7).flatMap((night) => {
    const summary = summarizeAgentChecks(night.agent ?? [], ignores, defaults, restores);
    return summary.total ? [summary.percent] : [];
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const { pages, recs, agentIgnoreDefaults, strategy, setStrategy, rangeDays, setRangeDays, dashSort, sortDash, watcherNote, pathFor } = useStore();
  const mobileWatcher = buildWatcher(pages, recs, "mobile", rangeDays, agentIgnoreDefaults);
  const desktopWatcher = buildWatcher(pages, recs, "desktop", rangeDays, agentIgnoreDefaults);
  const w = strategy === "mobile" ? mobileWatcher : desktopWatcher;
  const activePages = pages.filter(isPageActivelyMonitored);
  const currentWatcherNote = watcherNote?.modelVersion === 3 && strategy === "desktop" && rangeDays === 30 ? watcherNote : undefined;
  const regressingPages = activePages.filter((page) => ["mobile", "desktop"].some((device) => pageRangeTrend(page, device as "mobile" | "desktop", rangeDays) === "regressing")).length;
  const lowPerformancePages = activePages.filter((page) => page.history.length > 0 && (page.current.mobile.perf < 60 || page.current.desktop.perf < 60)).length;
  const latestSuccessAt = latestSuccessfulRunAt(activePages);
  const lastRunLabel = formatSuccessfulRunAt(latestSuccessAt);
  const watcherTimestamp = currentWatcherNote
    ? new Date(currentWatcherNote.generatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : lastRunLabel;

  const rows = pages.map((p) => {
    const mobileTrend = pageRangeTrend(p, "mobile", rangeDays);
    const desktopTrend = pageRangeTrend(p, "desktop", rangeDays);
    const trend = strategy === "mobile" ? mobileTrend : desktopTrend;
    const secondaryStrategy = strategy === "mobile" ? "desktop" : "mobile";
    const agentSummary = summarizeAgentChecks(p.agent, p.agentIgnores, agentIgnoreDefaults, p.agentIgnoreRestores);
    const { pass, total, ignored, percent: pct } = agentSummary;
    const am = scoreMeta(pct);
    const hasSnapshot = p.history.length > 0 || !!p.baseline;
    const hasBaseline = !!p.baseline && !!p.baselineCapturedAt;
    const cats = CATEGORIES.map((c) => {
      if (!hasSnapshot) {
        return { key: c.key, score: null as number | null, fg: C.faint, delta: "", deltaFg: C.faint, series: [] as number[], line: C.faint, secondary: null as number | null, secondaryFg: C.faint, secondaryLabel: strategy === "mobile" ? "D" : "M" };
      }
      const v = p.current[strategy][c.key];
      const sm = scoreMeta(v);
      const series = pageRangeSeries(p, strategy, c.key, rangeDays);
      const secondary = p.current[secondaryStrategy][c.key];
      const secondaryMeta = scoreMeta(secondary);
      if (!hasBaseline) {
        return { key: c.key, score: v as number | null, fg: sm.fg, delta: "", deltaFg: C.faint, series, line: sm.line, secondary, secondaryFg: secondaryMeta.fg, secondaryLabel: secondaryStrategy === "mobile" ? "M" : "D" };
      }
      const comparison = pageRangeComparison(p, strategy, c.key, rangeDays);
      const dm = comparison ? deltaMeta(comparison.to, comparison.from) : null;
      return { key: c.key, score: v as number | null, fg: sm.fg, delta: dm?.text ?? "", deltaFg: dm?.fg ?? C.faint, series, line: sm.line, secondary, secondaryFg: secondaryMeta.fg, secondaryLabel: secondaryStrategy === "mobile" ? "M" : "D" };
    });
    const sortVals: Record<string, string | number> = { title: p.title.toLowerCase(), status: trend, agent: pct };
    CATEGORIES.forEach((c) => (sortVals[c.key] = p.current[strategy][c.key]));
    return {
      id: p.id,
      title: p.title,
      url: p.url,
      successfulRunAt: lastSuccessfulRunAt(p),
      successfulRunLabel: formatSuccessfulRunAt(lastSuccessfulRunAt(p)),
      mobileTrend,
      desktopTrend,
      flag: flagChip(p.flag),
      cats,
      agentPct: total ? `${pct}%` : "—",
      agentFg: am.fg,
      agentSub: total ? `${pass}/${total}${ignored ? ` · ${ignored} ignored` : ""}` : ignored ? `${ignored} ignored` : "no scan",
      agentSeries: total ? agentSeries(historyForRange(p.history, rangeDays), p.agentIgnores, agentIgnoreDefaults, p.agentIgnoreRestores) : ([] as number[]),
      agentLine: am.line,
      sortVals,
    };
  });

  if (dashSort.col) {
    const dir = dashSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a.sortVals[dashSort.col as string];
      const bv = b.sortVals[dashSort.col as string];
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  const headers: { col: string; label: string; align: "left" | "center" }[] = [
    { col: "title", label: "Page", align: "left" },
    { col: "status", label: "Change", align: "left" },
    { col: "perf", label: "Performance", align: "center" },
    { col: "a11y", label: "Accessibility", align: "center" },
    { col: "bp", label: "Best practices", align: "center" },
    { col: "seo", label: "SEO", align: "center" },
    { col: "agent", label: "Agent", align: "center" },
  ];

  const tiles = [
    { label: "Monitored pages", value: w.total, color: C.accentSoft, tint: "rgba(20,110,245,0.09)", border: "rgba(59,137,255,0.22)", sub: `Last ${rangeDays} days` },
    { label: "Regressions", value: regressingPages, color: C.red, tint: "rgba(255,92,108,0.08)", border: "rgba(255,92,108,0.20)", sub: `M ${mobileWatcher.regressing} · D ${desktopWatcher.regressing}` },
    { label: "Low performance", value: lowPerformancePages, color: C.amber, tint: "rgba(255,154,61,0.08)", border: "rgba(255,154,61,0.20)", sub: `M ${mobileWatcher.lowPerformance} · D ${desktopWatcher.lowPerformance}` },
    { label: "Agent gaps", value: w.agentGaps, color: C.violetSoft, tint: "rgba(138,92,246,0.09)", border: "rgba(138,92,246,0.22)", sub: "Pages with failed checks" },
  ];

  return (
    <div>
      <header style={{ padding: "30px 40px 24px" }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Page performance</h1>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>
          Lighthouse &amp; agent-readiness across {w.total} monitored pages · {latestSuccessAt ? `latest successful PSI run ${lastRunLabel}` : "no successful live PSI run yet"}
        </p>
      </header>

      <div style={{ padding: "0 40px 48px" }}>
        {/* summary */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,1fr) minmax(0,1.15fr)", gap: 14, marginBottom: 40, alignItems: "stretch" }}>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ flex: "none", width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#146EF5,#8A5CF6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8}>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>The Watcher</div>
                <div style={{ fontSize: 11.5, color: C.faint }}>Summary updated {watcherTimestamp}</div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: C.violet, background: "rgba(138,92,246,0.14)", padding: "3px 8px", borderRadius: 5 }}>
                Agent
              </span>
            </div>
            <div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.6, color: C.dim }}>
              {currentWatcherNote ? (
                <p style={{ margin: 0 }}>{currentWatcherNote.text}</p>
              ) : (
                <>
                  <p style={{ margin: "0 0 12px" }}>
                    Over the last <strong style={{ color: C.text }}>{rangeDays} days</strong>, <strong style={{ color: C.red }}>{regressingPages}</strong> {regressingPages === 1 ? "page is" : "pages are"} regressing on at least one device and <strong style={{ color: C.amber }}>{lowPerformancePages}</strong> {lowPerformancePages === 1 ? "has" : "have"} low Performance. {w.agentGaps} {w.agentGaps === 1 ? "has" : "have"} agent-readiness gaps. The detail below follows the selected {strategy} charts.
                  </p>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 6 }}>What changed</div>
                  {w.changed.length ? (
                    <ul style={{ margin: "0 0 14px", paddingLeft: 18 }}>
                      {w.changed.map((b, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          {b.lead && <strong style={{ color: b.leadColor }}>{b.lead}</strong>} {b.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: "0 0 14px", color: C.muted }}>Not enough collections in this range to calculate change.</p>
                  )}
                  {w.topRec && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 6 }}>Top recommendation</div>
                      <p style={{ margin: 0, padding: "11px 13px", background: "rgba(20,110,245,0.08)", border: "1px solid rgba(20,110,245,0.22)", borderRadius: 8 }}>
                        Prioritize <strong style={{ color: C.text }}>{w.topRec.pageTitle}</strong> — acting on “{w.topRec.recTitle}” recovers an estimated <strong style={{ color: C.text }}>{w.topRec.savings}</strong> of load time.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gridAutoRows: "1fr", gap: 14 }}>
            {tiles.map((t) => (
              <div key={t.label} style={{ background: `linear-gradient(${t.tint}, ${t.tint}), ${C.panel}`, border: `1px solid ${t.border}`, borderRadius: 12, padding: "17px 19px" }}>
                <div style={{ fontSize: 12, color: C.muted }}>{t.label}</div>
                <div style={{ fontSize: 29, fontWeight: 600, marginTop: 5, color: t.color }}>{t.value}</div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{t.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-table-controls" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginBottom: 10, overflowX: "auto" }}>
          <SegToggle
            label="Dashboard chart device"
            value={strategy}
            onChange={setStrategy}
            options={[
              { value: "desktop", label: "Desktop", icon: <DesktopIcon size={13} /> },
              { value: "mobile", label: "Mobile", icon: <MobileIcon size={13} /> },
            ]}
          />
          <SegToggle label="Dashboard date range" value={rangeDays} onChange={setRangeDays} options={[3, 7, 30, 90].map((days) => ({ value: days as 3 | 7 | 30 | 90, label: `${days}d` }))} />
        </div>

        {/* table (horizontally scrollable on narrow screens instead of breaking) */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, minWidth: 880 }}>
            {headers.map((h) => (
              <SortHeader key={h.col} label={h.label} align={h.align} active={dashSort.col === h.col} dir={dashSort.dir} onSort={() => sortDash(h.col)} />
            ))}
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${row.title} details`}
              onClick={() => router.push(pathFor(`/pages/${row.id}`))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(pathFor(`/pages/${row.id}`));
                }
              }}
              style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "16px 24px", borderBottom: `1px solid ${C.rowBorder}`, cursor: "pointer", minWidth: 880 }}
            >
              <div style={{ minWidth: 0, paddingRight: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</span>
                  <span style={{ flex: "none", fontSize: 10, fontWeight: 550, letterSpacing: "0.03em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4, color: row.flag.fg, background: row.flag.bg }}>{row.flag.label}</span>
                </div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.url}</div>
                <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.successfulRunAt ? `Last successful run · ${row.successfulRunLabel}` : row.successfulRunLabel}</div>
              </div>
              <div>
                <DeviceChangeLabels mobile={row.mobileTrend} desktop={row.desktopTrend} />
              </div>
              {row.cats.map((c: { key: CategoryKey; score: number | null; fg: string; delta: string; deltaFg: string; series: number[]; line: string; secondary: number | null; secondaryFg: string; secondaryLabel: string }) => (
                <div key={c.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 84, height: 30 }}>
                    <Sparkline series={c.series} color={c.line} w={84} h={30} />
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: c.fg }}>{c.score === null ? "—" : c.score}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: c.deltaFg }}>{c.delta}</span>
                  </div>
                  <div style={{ fontSize: 9.5, color: C.faint }}>{c.secondaryLabel} <span style={{ color: c.secondaryFg, fontWeight: 600 }}>{c.secondary ?? "—"}</span></div>
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ width: 84, height: 30 }}>
                  <Sparkline series={row.agentSeries} color={row.agentLine} w={84} h={30} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1, color: row.agentFg }}>{row.agentPct}</div>
                <div style={{ fontSize: 10, lineHeight: 1.2, color: C.faint, textAlign: "center", whiteSpace: "nowrap" }}>{row.agentSub}</div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: C.faint, margin: "15px 2px 0", lineHeight: 1.5 }}>
          {`Change compares the oldest and newest nightly medians inside the selected ${rangeDays}-day range. Both device labels remain visible; charts and large scores follow the ${strategy} selection, with the other device shown beneath. Summary counts can overlap. Agent is derived from recorded per-check history.`}
        </p>
      </div>
    </div>
  );
}
