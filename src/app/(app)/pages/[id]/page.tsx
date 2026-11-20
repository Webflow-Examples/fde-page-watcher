"use client";

import { Fragment, useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useStore } from "@/components/store";
import { useIssuesView } from "@/components/use-issues-view";
import { StatusSection } from "./status-section";
import { CasesSection } from "./cases-section";
import { ReadingsSection } from "./readings-section";
import { normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import { pageRangeTrend } from "@/lib/scoring";
import { DESTINATION_LABEL, DESTINATION_PATH } from "@/lib/vocabulary";
import { queueOf } from "@/lib/issue-case";
import { PAGE_DETAIL_SECTIONS, type PageDetailSectionId } from "@/lib/page-detail-sections";
import { ObjectDetailHeader } from "@/components/object-detail-header";
import { PlusIcon, RefreshIcon } from "@/components/icons";
import { isKnownNativeElementId, nativeElementApplicability } from "@/lib/nativeElements";
/**
 * One page, on one scroll.
 *
 * There are no tabs. Four of them meant four routes into one object, three
 * hidden behind a guess about which word covered what the reader wanted; the
 * body is now the three sections `page-detail-sections.ts` names, in the order
 * that file states, and that array is the only statement of the order in `src/`.
 * Everything the tabs held is either one of those three things or belongs
 * somewhere else:
 *
 *   Recommendations   deleted. The cases ARE the recommendations, and they live
 *                     on the case, which is where the decision lives too.
 *   Opportunities     the same list under a second name.
 *   Agent-readiness   its failures are cases and its history is a reading, so
 *                     both halves are here already, in the two sections that own
 *                     them.
 *
 * Nothing here offers Accept or Dismiss. A lifecycle decision is made on the
 * case, having read it — offering it twice would let the same commitment be made
 * from two places with two different amounts of context, and one of them would be
 * the one made from a list.
 */

export default function PageDetail() {
  const searchParams = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { pages, strategy, rangeDays, setRangeDays, chartCat, setChartCat } = store;
  const page = pages.find((p) => p.id === id);
  // Every case in the project, so the ones on this page can be picked out. The
  // hook runs before the missing-page branch below because a hook must.
  const view = useIssuesView("show_all", "impact");

  useEffect(() => {
    setChartCat("perf");
  }, [id, setChartCat]);

  const openCases = useMemo(
    () => view.cases
      // Open means a queue holds it. Resolved and Dismissed are reachable only
      // through Show all, and a page's open work is not either of those.
      .filter((issue) => queueOf(issue.state) !== "settled" && issue.pageIds.includes(id))
      // An excluded finding does not count for this site, so it is not open work
      // — it keeps its reading below, under Excluded.
      .filter((issue) => !isKnownNativeElementId(issue.cause)
        || nativeElementApplicability(page?.nativeElementControls, issue.cause) === "included"),
    [view.cases, id, page?.nativeElementControls],
  );

  if (!page) {
    return (
      <div style={{ padding: 40 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-body)" }}>
          No page with that id
        </h1>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)", maxWidth: "60ch" }}>
          It may have been removed from the Watchlist, or the link may be old.
        </p>
        <Link
          href={store.pathFor(DESTINATION_PATH.pages)}
          style={{ display: "inline-block", marginTop: 14, fontSize: 13, color: "var(--action-primary-ink)" }}
        >
          ← {DESTINATION_LABEL.pages}
        </Link>
      </div>
    );
  }

  const isPending = !page.baseline || !page.baselineCapturedAt;
  const collectionBlocked = page.flag === "paused" || (!!page.runState && page.runState !== "failed");
  const activeJob = store.jobs?.find((job) => job.runId === page.runId);
  const watchedPageHref = /^[a-z][a-z\d+.-]*:\/\//i.test(page.url) ? page.url : `https://${page.url}`;
  const thresholds = normalizePerformanceThresholds(store.performanceThresholds);
  // A development-only comparison of the two trend renderings side by side.
  const isStatusPreview = process.env.NODE_ENV === "development" && searchParams.get("statusPreview") === "compare";
  const mobileTrend = isStatusPreview ? "regressing" : pageRangeTrend(page, "mobile", rangeDays, thresholds);
  const desktopTrend = isStatusPreview ? "improving" : pageRangeTrend(page, "desktop", rangeDays, thresholds);

  /**
   * The section views, keyed by id.
   *
   * A `Record`, not an array: its key order cannot decide what appears where, so
   * the only thing that can is `PAGE_DETAIL_SECTIONS`. Adding a section to the
   * type without adding it here is a compile error rather than a silent gap.
   */
  const sections: Record<PageDetailSectionId, React.ReactNode> = {
    status: (
      <StatusSection
        page={page}
        job={activeJob}
        desktopTrend={desktopTrend}
        mobileTrend={mobileTrend}
        openCases={openCases.length}
        rangeDays={rangeDays}
        setRangeDays={setRangeDays}
        isPending={isPending}
      />
    ),
    cases: (
      <CasesSection
        page={page}
        cases={openCases}
        basePath={store.basePath}
        canManage={store.canManageProject}
        onExclude={(findingId, reason) => store.setNativeElementApplicability(page.id, findingId, reason)}
        onInclude={(findingId) => store.setNativeElementApplicability(page.id, findingId, null)}
      />
    ),
    readings: (
      <ReadingsSection
        page={page}
        strategy={strategy}
        rangeDays={rangeDays}
        chartCat={chartCat}
        setChartCat={setChartCat}
        store={store}
        isPending={isPending}
      />
    ),
  };

  return (
    <div>
      <ObjectDetailHeader
        breadcrumb={{ label: DESTINATION_LABEL.pages, href: store.pathFor(DESTINATION_PATH.pages) }}
        title={page.title}
        actions={store.canManageProject ? (
          <>
            <button
              disabled={collectionBlocked}
              title={page.flag === "paused" ? "Change this page to Watching or Priority before collecting" : undefined}
              onClick={() => store.runPage(page.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "9px 15px",
                border: "none",
                borderRadius: 8,
                background: "var(--action-primary-bg)",
                color: "var(--action-primary-text)",
                fontSize: 12.5,
                fontWeight: 550,
                cursor: collectionBlocked ? "not-allowed" : "pointer",
                opacity: collectionBlocked ? 0.65 : 1,
                whiteSpace: "nowrap",
              }}
            >
              <RefreshIcon size={15} style={{ color: "var(--action-primary-text)" }} />
              {page.flag === "paused"
                ? "Paused"
                : page.runState === "queued"
                  ? "Queued…"
                  : page.runState === "dispatching"
                    ? "Starting…"
                    : page.runState === "waiting_for_evidence"
                      ? "Waiting for evidence…"
                      : page.runState === "running"
                        ? "Running…"
                        : "Run now"}
            </button>
            <button
              onClick={() => store.openMarker(page.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "9px 15px",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                background: "var(--surface-card)",
                color: "var(--text-body)",
                fontSize: 12.5,
                fontWeight: 550,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <PlusIcon size={15} />
              Marker
            </button>
          </>
        ) : undefined}
        metadata={
          <a
            href={watchedPageHref}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--action-primary-ink)",
              textDecoration: "none",
            }}
          >
            <span>{page.url}</span>
            <ArrowUpRightIcon size={14} weight="regular" aria-hidden="true" />
          </a>
        }
      />

      <div style={{ padding: "0 40px 64px" }}>
        {/* Rendered from the array, so the array is the order. */}
        {PAGE_DETAIL_SECTIONS.map((section) => (
          <Fragment key={section}>{sections[section]}</Fragment>
        ))}
      </div>
    </div>
  );
}
