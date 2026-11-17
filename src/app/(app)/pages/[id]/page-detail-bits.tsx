import {
  PAGE_DETAIL_SECTION_HEADING,
  pageDetailAnchor,
  type PageDetailSectionId,
} from "@/lib/page-detail-sections";

/* ── The section shell ──────────────────────────────────────────────────── */

/**
 * One band of the scroll, named by its id.
 *
 * The heading comes from the registry of sections rather than from the call
 * site, so the jump link's words and the heading it lands on cannot disagree.
 */
export function Section({
  id,
  aside,
  children,
}: {
  id: PageDetailSectionId;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const anchor = pageDetailAnchor(id);
  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-heading`}
      // So a jump link does not park the heading under the sticky chrome.
      style={{ marginTop: 30, scrollMarginTop: 20 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h2
          id={`${anchor}-heading`}
          style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-body)" }}
        >
          {PAGE_DETAIL_SECTION_HEADING[id]}
        </h2>
        {aside ? <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One labelled cell of the status strip: what it is above, the reading below. */
export function Reading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6, minHeight: 20 }}>
        {children}
      </div>
    </div>
  );
}
