"use client";

import type { IssueCase } from "@/lib/issue-case";
import { PLATFORM_OWNED_LABEL } from "@/lib/webflowPerformance";
import { IssueRow } from "@/components/issue-row";

/**
 * The readings Webflow owns.
 *
 * A Webflow-generated page ships some of its own code: the render-blocking
 * stylesheet and `webfont.js`, the boot-time work, the main-thread work. Those
 * audits are not the customer's to fix, and until now they were classified
 * "no direct action" and then filtered out of the app entirely — so the audit's
 * 981 ms render-blocking finding had nowhere to appear.
 *
 * Hiding a reading is the failure. So platform-owned cases are shown here, under
 * their own heading, with the same row every other case gets: what it is, which
 * pages, how much it costs, and whose work it is. What they are NOT is work: the
 * count on the Decide tab excludes them, Start Here never offers one, and the
 * case offers no Accept, because there is nothing for the reader to accept.
 *
 * The heading carries the block's accessible name, and each row keeps its one
 * link, exactly as the table's rows do.
 */
export function WebflowOwned({
  cases,
  basePath,
  pageTitles,
  lastRunAt,
}: {
  cases: readonly IssueCase[];
  basePath: string;
  pageTitles: Record<string, string>;
  lastRunAt?: string;
}) {
  if (cases.length === 0) return null;

  // Worst reading first, in the unit each case measured (rule 18/19: never a
  // sum across pages, and an absent reading is not a small one).
  const ordered = [...cases].sort((left, right) => {
    const measured = (issue: IssueCase) => (issue.impactMs > 0 ? 2 : issue.impactBytes ? 1 : 0);
    return measured(right) - measured(left)
      || right.impactMs - left.impactMs
      || (right.impactBytes ?? 0) - (left.impactBytes ?? 0)
      || left.id.localeCompare(right.id);
  });

  return (
    <section aria-labelledby="webflow-owned-heading" style={{ marginTop: 18 }}>
      <h2
        id="webflow-owned-heading"
        style={{
          margin: 0,
          padding: "14px 40px 4px",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-body)",
          borderTop: "1px solid var(--border-hairline)",
        }}
      >
        {PLATFORM_OWNED_LABEL}
      </h2>
      <p style={{ margin: 0, padding: "0 40px 8px", maxWidth: "72ch", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
        {`Nothing for you to do: Webflow ships this code. ${ordered.length === 1 ? "This reading is" : "These readings are"} shown so ${ordered.length === 1 ? "it is" : "they are"} not hidden from you, and ${ordered.length === 1 ? "it is" : "they are"} not counted as your work.`}
      </p>
      <div style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        {ordered.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            basePath={basePath}
            pageTitles={pageTitles}
            lastRunAt={lastRunAt}
          />
        ))}
      </div>
    </section>
  );
}
