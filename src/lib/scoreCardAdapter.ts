import type { CategoryKey, Night, RangeDays, Strategy, WatchPage } from "./types";
import { historyForStrategy, pageHistoryForRange, pageRecordedHistoryForRange } from "./scoring";
import { isTaskMarker } from "./taskMarkers";
import type { ScoreCardData, ScoreCardMarker, ScoreCardRange } from "@/components/ScoreCard";

/**
 * ScoreCard's series responds to the page's date-range control (3/7/30/90
 * days), the same as every other chart on the detail page (Sparkline via
 * pageRangeSeries, HistoryChart, etc.). This reuses pageHistoryForRange —
 * calendar-bound, trusted (no PSI anomalies), post-baseline history — so the
 * card and the rest of the page always agree on what's "in range."
 */
export function scoreCardSeries(page: WatchPage, strategy: Strategy, key: CategoryKey, rangeDays: RangeDays, now = Date.now()): number[] {
  return historyForStrategy(pageHistoryForRange(page, rangeDays, now), strategy)
    .map((night) => night.scores[strategy][key].m);
}

/** Build one category's ScoreCard data from a page's real recorded history, for the selected range. */
export function scoreCardDataForCategory(page: WatchPage, key: CategoryKey, title: string, rangeDays: RangeDays, now = Date.now()): ScoreCardData {
  return {
    title,
    desktop: scoreCardSeries(page, "desktop", key, rangeDays, now),
    mobile: scoreCardSeries(page, "mobile", key, rangeDays, now),
  };
}

/**
 * Medium/Large ScoreCard data, sourced from the page's real recorded history
 * (not fabricated): the run-to-run range (CategoryScore.lo/hi), the real
 * anomaly-quarantine flag (Night.evidenceStatus), and real change markers
 * (WatchPage.markers), the same fields HistoryChart already renders for this
 * page's History tab. Unlike scoreCardDataForCategory (small/xsmall, trusted
 * history only, frozen), this includes quarantined nights in the plotted
 * series so medium/large can draw the real gap around them, matching
 * HistoryChart's timeline (trusted + excluded history, merged and sorted).
 */
export function scoreCardScaledDataForCategory(page: WatchPage, key: CategoryKey, title: string, rangeDays: RangeDays, now = Date.now()): ScoreCardData {
  const recorded = pageRecordedHistoryForRange(page, rangeDays, now);
  const desktopNights = historyForStrategy(recorded, "desktop");
  const mobileNights = historyForStrategy(recorded, "mobile");

  const seriesFor = (nights: Night[], strategy: Strategy) => nights.map((night) => night.scores[strategy][key].m);
  const rangeFor = (nights: Night[], strategy: Strategy): ScoreCardRange[] =>
    nights.map((night) => ({ lo: night.scores[strategy][key].lo, hi: night.scores[strategy][key].hi }));
  const trustedFor = (nights: Night[]) => nights.map((night) => night.evidenceStatus !== "provider-anomaly");

  // A marker is page-level (see ChangeMarker.i, the history index it sits
  // at), so it's resolved once against desktop's timeline and reused for
  // both devices' charts — the same night index applies to either series.
  const markers: ScoreCardMarker[] = page.markers.flatMap((marker) => {
    const index = desktopNights.findIndex((night) => night.i === marker.i);
    return index >= 0 ? [{ index, text: marker.text, isTask: isTaskMarker(marker) }] : [];
  });

  return {
    title,
    desktop: seriesFor(desktopNights, "desktop"),
    mobile: seriesFor(mobileNights, "mobile"),
    desktopRange: rangeFor(desktopNights, "desktop"),
    mobileRange: rangeFor(mobileNights, "mobile"),
    desktopTrusted: trustedFor(desktopNights),
    mobileTrusted: trustedFor(mobileNights),
    markers,
  };
}
