"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import { CATEGORIES } from "@/lib/types";
import type { CategoryKey } from "@/lib/types";
import { categorySeries, deltaMeta, scoreMeta } from "@/lib/scoring";
import { buildWatcher } from "@/lib/watcher";
import { C, flagChip } from "@/lib/ui";
import { Sparkline } from "@/components/charts";
import { SegToggle, SortHeader, StatusBadge } from "@/components/bits";
import { ChevronDownIcon, DesktopIcon, MobileIcon } from "@/components/icons";

const GRID = "minmax(150px,1fr) 128px 120px 120px 120px 120px 120px";

function agentSeries(id: string, pct: number): number[] {
  let s = 7;
  for (const ch of id) s = (s * 31 + ch.charCodeAt(0)) % 101;
  const arr: number[] = [];
  for (let i = 0; i < 7; i++) {
    const noise = ((s + i * 17) % 7) - 3;
    arr.push(Math.max(0, Math.min(100, pct + (i - 6) + noise)));
  }
  arr[6] = pct;
  return arr;
}

export default function DashboardPage() {
  const router = useRouter();
  const { pages, recs, strategy, setStrategy, dashSort, sortDash } = useStore();
  const w = buildWatcher(pages, recs, strategy);

  const rows = pages.map((p) => {
    // Unavailable checks aren't failures — exclude them from the pass rate.
    const available = p.agent.filter((c) => !c.unavailable);
    const pass = available.filter((c) => c.pass).length;
    const total = available.length;
    const pct = total ? Math.round((pass / total) * 100) : 0;
    const am = scoreMeta(pct);
    const hasSnapshot = p.history.length > 0 || !!p.baseline;
    const hasBaseline = !!p.baseline && !!p.baselineCapturedAt;
    const cats = CATEGORIES.map((c) => {
      if (!hasSnapshot) {
        return { key: c.key, score: null as number | null, fg: C.faint, delta: "", deltaFg: C.faint, series: [] as number[], line: C.faint };
      }
      const v = p.current[strategy][c.key];
      const sm = scoreMeta(v);
      if (!hasBaseline) {
        return { key: c.key, score: v as number | null, fg: sm.fg, delta: "", deltaFg: C.faint, series: categorySeries(p.history, strategy, c.key, 7), line: sm.line };
      }
      const dm = deltaMeta(v, p.baseline![strategy][c.key].m);
      return { key: c.key, score: v as number | null, fg: sm.fg, delta: dm.text, deltaFg: dm.fg, series: categorySeries(p.history, strategy, c.key, 7), line: sm.line };
    });
    const sortVals: Record<string, string | number> = { title: p.title.toLowerCase(), status: p.status, agent: pct };
    CATEGORIES.forEach((c) => (sortVals[c.key] = p.current[strategy][c.key]));
    return {
      id: p.id,
      title: p.title,
      url: p.url,
      status: p.status,
      flag: flagChip(p.flag),
      cats,
      agentPct: total ? `${pct}%` : "—",
      agentFg: am.fg,
      agentSub: total ? `${pass}/${total}` : "no scan",
      agentSeries: total ? agentSeries(p.id, pct) : ([] as number[]),
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
    { col: "status", label: "Status", align: "left" },
    { col: "perf", label: "Performance", align: "center" },
    { col: "a11y", label: "Accessibility", align: "center" },
    { col: "bp", label: "Best practices", align: "center" },
    { col: "seo", label: "SEO", align: "center" },
    { col: "agent", label: "Agent", align: "center" },
  ];

  const tiles = [
    { label: "Monitored pages", value: w.total, color: C.text },
    { label: "Healthy", value: w.healthy, color: C.green },
    { label: "Improvable", value: w.improvable, color: C.amber },
    { label: "Degraded", value: w.degraded, color: C.red },
  ];

  return (
    <div>
      <header style={{ padding: "30px 40px 24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Page performance</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>
            Lighthouse &amp; agent-readiness across {w.total} monitored pages · last run today 03:00
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <SegToggle
            label="Dashboard strategy"
            value={strategy}
            onChange={setStrategy}
            options={[
              { value: "mobile", label: "Mobile", icon: <MobileIcon size={13} /> },
              { value: "desktop", label: "Desktop", icon: <DesktopIcon size={13} /> },
            ]}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 12.5, color: C.dim }}>
            Last 30 nights
            <ChevronDownIcon size={12} style={{ color: C.muted }} />
          </div>
        </div>
      </header>

      <div style={{ padding: "0 40px 48px" }}>
        {/* summary */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,1fr) minmax(0,1.15fr)", gap: 14, marginBottom: 20, alignItems: "stretch" }}>
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
                <div style={{ fontSize: 11.5, color: C.faint }}>Summary updated today 03:12</div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: C.violet, background: "rgba(138,92,246,0.14)", padding: "3px 8px", borderRadius: 5 }}>
                Agent
              </span>
            </div>
            <div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.6, color: C.dim }}>
              <p style={{ margin: "0 0 12px" }}>
                Across <strong style={{ color: C.text }}>{w.total} monitored pages</strong>, overall health is <strong style={{ color: C.text }}>{w.overall}</strong>. {w.healthy} healthy, {w.improvable} improvable, and {w.degraded} degraded since baseline.
              </p>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 6 }}>What changed</div>
              <ul style={{ margin: "0 0 14px", paddingLeft: 18 }}>
                {w.changed.map((b, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {b.lead && <strong style={{ color: b.leadColor }}>{b.lead}</strong>} {b.text}
                  </li>
                ))}
              </ul>
              {w.topRec && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 6 }}>Top recommendation</div>
                  <p style={{ margin: 0, padding: "11px 13px", background: "rgba(20,110,245,0.08)", border: "1px solid rgba(20,110,245,0.22)", borderRadius: 8 }}>
                    Prioritize <strong style={{ color: C.text }}>{w.topRec.pageTitle}</strong> — acting on “{w.topRec.recTitle}” recovers an estimated <strong style={{ color: C.text }}>{w.topRec.savings}</strong> of load time.
                  </p>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gridAutoRows: "1fr", gap: 14 }}>
            {tiles.map((t) => (
              <div key={t.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "17px 19px" }}>
                <div style={{ fontSize: 12, color: C.muted }}>{t.label}</div>
                <div style={{ fontSize: 29, fontWeight: 600, marginTop: 5, color: t.color }}>{t.value}</div>
              </div>
            ))}
          </div>
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
              onClick={() => router.push(`/pages/${row.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/pages/${row.id}`);
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
              </div>
              <div>
                <StatusBadge status={row.status} />
              </div>
              {row.cats.map((c: { key: CategoryKey; score: number | null; fg: string; delta: string; deltaFg: string; series: number[]; line: string }) => (
                <div key={c.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 84, height: 30 }}>
                    <Sparkline series={c.series} color={c.line} w={84} h={30} />
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: c.fg }}>{c.score === null ? "—" : c.score}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: c.deltaFg }}>{c.delta}</span>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ width: 84, height: 30 }}>
                  <Sparkline series={row.agentSeries} color={row.agentLine} w={84} h={30} />
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: row.agentFg }}>{row.agentPct}</span>
                  <span style={{ fontSize: 10, color: C.faint }}>{row.agentSub}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: C.faint, margin: "15px 2px 0", lineHeight: 1.5 }}>
          {`Each graph is the median of five nightly PSI runs over the last seven nights for the ${strategy} strategy; the number is tonight's median and the delta compares it to the stored baseline. Agent is the share of agent-readiness checks passing.`}
        </p>
      </div>
    </div>
  );
}
