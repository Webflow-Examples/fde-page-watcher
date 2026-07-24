/** A lone observation has no direction; draw it as a horizontal series. */
export function plottedSparklineSeries(series: number[]): number[] {
  return series.length === 1 ? [series[0], series[0]] : series;
}

/** Snap a pointer's chart-local x coordinate to the nearest history point. */
export function snappedHistoryIndex(
  pointerX: number,
  chartWidth: number,
  pointCount: number,
  padLeft = 38,
  padRight = 20,
): number {
  if (pointCount <= 1) return 0;
  const plotWidth = Math.max(1, chartWidth - padLeft - padRight);
  const clampedX = Math.min(chartWidth - padRight, Math.max(padLeft, pointerX));
  return Math.round(((clampedX - padLeft) / plotWidth) * (pointCount - 1));
}

const LONG_MONTHS: Record<string, string> = {
  Jan: "January",
  Feb: "February",
  Mar: "March",
  Apr: "April",
  May: "May",
  Jun: "June",
  Jul: "July",
  Aug: "August",
  Sep: "September",
  Oct: "October",
  Nov: "November",
  Dec: "December",
};

function ordinalDay(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13
    ? "th"
    : day % 10 === 1
      ? "st"
      : day % 10 === 2
        ? "nd"
        : day % 10 === 3
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}

/** Expand a stored chart label into a readable date such as "July 23rd". */
export function formatHistoryTooltipDate(dateLabel: string, iso?: string): string {
  const labelMatch = /^([A-Z][a-z]{2})\s+(\d{1,2})$/.exec(dateLabel.trim());
  if (labelMatch && LONG_MONTHS[labelMatch[1]]) {
    return `${LONG_MONTHS[labelMatch[1]]} ${ordinalDay(Number(labelMatch[2]))}`;
  }

  const parsed = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    return `${LONG_MONTHS[date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })]} ${ordinalDay(date.getUTCDate())}`;
  }

  return dateLabel;
}
