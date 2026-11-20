import Link from "next/link";
import {
  DEFAULT_SORT_DIRECTION,
  ISSUE_SORT_LABEL,
  reverseDirection,
  type IssueSort,
  type SortDirection,
} from "@/lib/issue-list";
import { ISSUE_ROW_COLUMNS, ISSUE_ROW_GAP, NUMERIC_CELL, TRUNCATE_CELL } from "@/components/issue-row";

/**
 * One header row, shared by every queue.
 *
 * Decide makes each header a sort link. Fix, Watch and Settled pass no sort and
 * get the same labels as plain text, so the columns line up even where the
 * order is fixed by the queue's question rather than by the reader.
 */
const CASE_COLUMNS = [
  "cause",
  "pages",
  "date",
  "confidence",
  "impact",
  "effort",
] as const satisfies readonly IssueSort[];

const DIRECTION_GLYPH: Record<SortDirection, string> = { asc: "\u2191", desc: "\u2193" };
const DIRECTION_WORD: Record<SortDirection, string> = { asc: "ascending", desc: "descending" };

export interface CaseColumnHeadersProps {
  sort?: IssueSort;
  direction?: SortDirection;
  hrefFor?: (next: { sort: IssueSort; dir?: SortDirection }) => string;
  /** The queue's word for the Date column: Detected, Accepted, Fixed, Settled. */
  dateLabel?: string;
  /** Queue-specific header labels, such as Confidence becoming Checkpoints. */
  labels?: Partial<Record<IssueSort, string>>;
}

export function CaseColumnHeaders({ sort, direction, hrefFor, dateLabel, labels }: CaseColumnHeadersProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: ISSUE_ROW_COLUMNS,
        gap: ISSUE_ROW_GAP,
        alignItems: "center",
        padding: "0 40px 8px",
        // Registry rule 8: a column header tells you which column you are
        // reading, so it stays at or above the 12px floor.
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
      }}
    >
      {CASE_COLUMNS.map((key) => {
        const numeric = key === "impact" || key === "effort";
        const label = labels?.[key] ?? (key === "date" && dateLabel ? dateLabel : ISSUE_SORT_LABEL[key]);
        const style = {
          display: "flex",
          alignItems: "center",
          justifyContent: numeric ? "flex-end" : "flex-start",
          gap: 4,
          minWidth: 0,
          font: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
        } as const;

        if (!sort || !direction || !hrefFor) {
          return (
            <span key={key} style={style}>
              <span style={numeric ? NUMERIC_CELL : TRUNCATE_CELL}>{label}</span>
            </span>
          );
        }

        const active = key === sort;
        const next = active ? reverseDirection(direction) : DEFAULT_SORT_DIRECTION[key];
        return (
          <Link
            key={key}
            href={hrefFor({ sort: key, dir: next })}
            replace
            aria-label={
              active
                ? `Sorted by ${label}, ${DIRECTION_WORD[direction]}. Sort ${DIRECTION_WORD[next]}.`
                : `Sort by ${label}`
            }
            style={{
              ...style,
              textDecoration: active ? "underline" : "none",
              textUnderlineOffset: 3,
              color: active ? "var(--text-body)" : "inherit",
            }}
          >
            {numeric && active ? <span aria-hidden="true">{DIRECTION_GLYPH[direction]}</span> : null}
            <span style={numeric ? NUMERIC_CELL : TRUNCATE_CELL}>{label}</span>
            {!numeric && active ? <span aria-hidden="true">{DIRECTION_GLYPH[direction]}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}
