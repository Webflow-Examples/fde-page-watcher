"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useIssuesView, useStore } from "@/components/store";
import { DESTINATION_LABEL, DESTINATION_PATH } from "@/lib/vocabulary";
import { CaseDetail } from "@/components/case-detail";

/**
 * One case.
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
  const id = decodeURIComponent(String(params?.id ?? ""));
  const { pages, pathFor } = useStore();
  const view = useIssuesView("show_all", "impact");

  const issue = useMemo(() => view.cases.find((item) => item.id === id), [view.cases, id]);

  const pageTitles = view.pageTitles;
  const pagePaths = useMemo(
    () => Object.fromEntries(pages.map((page) => [page.id, page.url ?? page.title])),
    [pages],
  );

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
  return <CaseDetail issue={issue} pageTitles={pageTitles} pagePaths={pagePaths} />;
}
