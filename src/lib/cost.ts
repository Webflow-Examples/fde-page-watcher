// Coarse estimated-cost band derived from a recommendation's type (REQ-055).
// A precise/learned effort model is a later bet; this ships as whole hours/days.

const BANDS: { match: RegExp; band: string }[] = [
  { match: /unused-javascript|unused javascript|reduce.*javascript/i, band: "2 days" },
  { match: /largest-contentful-paint|lcp|render-blocking/i, band: "1 day" },
  { match: /server-response|ttfb|main-thread|bootup-time/i, band: "2 days" },
  { match: /modern-image-formats|next-gen|uses-webp|uses-optimized-images/i, band: "1 day" },
  { match: /third-party|legacy-javascript|duplicated-javascript/i, band: "1 day" },
  { match: /uses-responsive-images|properly size|offscreen-images/i, band: "3 hours" },
  { match: /unminified|text-compression|uses-text-compression/i, band: "2 hours" },
  { match: /preconnect|preload|font-display|efficient-animated/i, band: "2 hours" },
  { match: /accessible name|aria|color-contrast|label/i, band: "3 hours" },
];

/** Coarse effort band ("2 days" / "4 hours") from an audit id or title. */
export function costBand(idOrTitle: string): string {
  for (const b of BANDS) if (b.match.test(idOrTitle)) return b.band;
  return "1 day";
}
