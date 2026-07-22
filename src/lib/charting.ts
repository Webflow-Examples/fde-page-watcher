/** A lone observation has no direction; draw it as a horizontal series. */
export function plottedSparklineSeries(series: number[]): number[] {
  return series.length === 1 ? [series[0], series[0]] : series;
}
