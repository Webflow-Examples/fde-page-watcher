"use client";

import { useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useIssuesView, useStore } from "@/components/store";
import { DESTINATION_LABEL, DESTINATION_PATH } from "@/lib/vocabulary";
import { CaseDetail } from "@/components/case-detail";
import { DigestBanner } from "@/components/digest-banner";
import { DIGEST_DATE_PARAM, DIGEST_LINE_PARAM, digestLineFor, parseDigestArrival } from "@/lib/digest";
import { normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import { casePath } from "@/lib/paths";

/**
 * One case, at `/issues/{id}`.
 *
 * Addressed by its own id, which is what makes a digest link worth sending: a
 * case id is stable, and a queue is a filter over states that change. A link to
 * `/issues?queue=decide` sends the reader wherever Decide happens to be pointing
 * today, which on any day but the first is not the thing the message was about.
 *
 * The id is the whole address. There is no `/case/` segment in front of it: the
 * id already says this is a case, and a queue cannot shadow it because a queue
 * is a query parameter rather than a path segment. `digest-arrival` holds both
 * halves of that.
 *
 * The per-page exclude control is NOT wired here, and that is deliberate rather
 * than unfinished. A case is derived from the collector's records
 * (`issueCasesFrom`), so there is nowhere yet to keep an exclusion: the control
 * would accept the reader's decision, show it applied, and lose it on the next
 * reload. An exception you can state is the entire reason the per-page design
 * was chosen over all-or-nothing accept, and an exception that forgets itself is
 * worse than not offering one.
 *
 * F5 adds the persistence and passes the two handlers in. Nothing else has to
 * change: `excludePage` and `includePage` take and return whole cases, the
 * table already renders an exclusion it is given — struck through, with its
 * reason — and the checkpoint evaluator already measures counted pages only.
 */
export default function CasePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const { pages, pathFor, performanceThresholds } = useStore();
  const view = useIssuesView("show_all", "impact");

  const issue = useMemo(() => view.cases.find((item) => item.id === id), [view.cases, id]);

  const pageTitles = view.pageTitles;
  const pagePaths = useMemo(
    () => Object.fromEntries(pages.map((page) => [page.id, page.url ?? page.title])),
    [pages],
  );

  const arrival = useMemo(
    () => parseDigestArrival((key) => searchParams.get(key)),
    [searchParams],
  );

  /**
   * The line the digest wrote, rebuilt here.
   *
   * The URL carries which digest and which section, never the sentence. That is
   * what keeps the banner and the message from wording the same fact
   * differently — and it means an old link still shows a line that reads
   * correctly against the case as it stands today, rather than a sentence
   * preserved in amber from three weeks ago.
   */
  const arrivalLine = useMemo(() => {
    if (!arrival || !issue) return null;
    return digestLineFor(arrival.kind, issue, {
      pageTitles,
      pagesById: Object.fromEntries(pages.map((page) => [page.id, page])),
      thresholds: normalizePerformanceThresholds(performanceThresholds),
      date: arrival.date,
    });
  }, [arrival, issue, pageTitles, pages, performanceThresholds]);

  /**
   * Dismissal is a URL change, not a stored flag.
   *
   * `replace` rather than `push`, so Back goes where the reader came from instead
   * of re-showing the banner they just dismissed. Every other parameter on the
   * URL survives.
   */
  const dismissArrival = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(DIGEST_DATE_PARAM);
    next.delete(DIGEST_LINE_PARAM);
    const query = next.toString();
    router.replace(pathFor(`${casePath(id)}${query ? `?${query}` : ""}`));
  }, [id, pathFor, router, searchParams]);

  if (!issue) {
    return (
      <div style={{ padding: "40px" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-body)" }}>
          No case with that id
        </h1>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)", maxWidth: "60ch" }}>
          It may have been re-derived under a different id by a later run, or the link may be old.
        </p>
        <Link
          href={pathFor(DESTINATION_PATH.issues)}
          style={{ display: "inline-block", marginTop: 14, fontSize: 13, color: "var(--action-primary-ink)" }}
        >
          ← {DESTINATION_LABEL.issues}
        </Link>
      </div>
    );
  }

  // No onExclude/onInclude until F5. See the note above.
  return (
    <>
      {arrival && arrivalLine ? (
        <div style={{ paddingTop: 20 }}>
          <DigestBanner date={arrival.date} line={arrivalLine} onDismiss={dismissArrival} />
        </div>
      ) : null}
      <CaseDetail issue={issue} pageTitles={pageTitles} pagePaths={pagePaths} />
    </>
  );
}
