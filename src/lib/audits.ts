import type { Audit } from "./types";
import { C } from "./ui";

/**
 * Failing audits / opportunities for the page detail. In v1 these mirror the
 * prototype's representative Lighthouse opportunity set; the real collector
 * replaces them with the page's actual PSI opportunities (with overallSavingsMs).
 */
export function auditsFor(): Audit[] {
  return [
    { title: "Largest Contentful Paint element", desc: "Hero video poster is the LCP element at 3.4 s. Preload the poster and defer the video.", category: "Performance", savings: "1.9 s", dot: C.red },
    { title: "Reduce unused JavaScript", desc: "420 KiB of unused script from marketing tags loaded before interaction.", category: "Performance", savings: "1.8 s", dot: C.red },
    { title: "Serve images in next-gen formats", desc: "WebP/AVIF would save on the customer-logo strip and screenshots.", category: "Performance", savings: "1.2 s", dot: C.amber },
    { title: "Properly size images", desc: "Several images are served larger than their rendered size.", category: "Performance", savings: "0.9 s", dot: C.amber },
    { title: "Eliminate render-blocking resources", desc: "Two stylesheets block first paint; inline critical CSS.", category: "Performance", savings: "0.6 s", dot: C.amber },
    { title: "Buttons do not have an accessible name", desc: "Icon-only buttons in the footer lack aria-labels.", category: "Accessibility", savings: "—", dot: C.amber },
  ];
}
