import type { Flag } from "./types";

export interface DashboardSortState {
  col: string | null;
  dir: "asc" | "desc";
}

export interface DashboardSortableRow {
  monitoringFlag: Flag;
  watchlistOrder: number;
  sortVals: Record<string, string | number>;
}

const DEFAULT_FLAG_RANK: Record<Flag, number> = {
  priority: 0,
  watching: 1,
  paused: 2,
};

/**
 * Default dashboard order follows monitoring importance. Once a column is
 * selected, that explicit sort replaces the monitoring hierarchy.
 */
export function sortDashboardRows<T extends DashboardSortableRow>(
  rows: ReadonlyArray<T>,
  sort: DashboardSortState,
): T[] {
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((left, right) => {
      if (!sort.col) {
        const rankDelta = DEFAULT_FLAG_RANK[left.row.monitoringFlag]
          - DEFAULT_FLAG_RANK[right.row.monitoringFlag];
        return rankDelta
          || left.row.watchlistOrder - right.row.watchlistOrder
          || left.originalIndex - right.originalIndex;
      }

      const direction = sort.dir === "asc" ? 1 : -1;
      const leftValue = left.row.sortVals[sort.col];
      const rightValue = right.row.sortVals[sort.col];
      if (leftValue < rightValue) return -1 * direction;
      if (leftValue > rightValue) return direction;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ row }) => row);
}
