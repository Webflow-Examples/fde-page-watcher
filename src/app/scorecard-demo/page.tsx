"use client";

import { useState } from "react";
import { ScoreCard, scoreCardFlexItemStyle, type ScoreCardData, type ScoreCardDensity } from "@/components/ScoreCard";
import { ScoreCardDensityControl } from "@/components/ScoreCardDensityControl";

// Standalone demo route for the ScoreCard component — realistic 24-point
// series per category so hovering the chart can be compared against the
// design reference. This route intentionally sits outside the (app) route
// group: that group's layout requires a signed-in identity and an
// accessible project (see src/app/(app)/layout.tsx), which would be an
// unrelated barrier for reviewing a single presentational component.
//
// The density control here mirrors the Details page's usage: one piece of
// page-level state that every card reads, also driving the row's wrapping
// via the shared scoreCardFlexItemStyle (see the ScoreCard density handoff
// §6). Flexbox, not grid: a card that wraps to a new row needs to stretch
// to fill that row's leftover space, and grid's `auto-fit` sizes every row's
// tracks identically instead.

const CARDS: ScoreCardData[] = [
  {
    title: "Performance",
    desktop: [86, 87, 85, 88, 86, 87, 85, 86, 88, 86, 85, 87, 86, 88, 86, 85, 87, 86, 84, 86, 72, 70, 71, 71],
    mobile: [69, 66, 63, 68, 58, 62, 55, 60, 52, 57, 50, 54, 58, 51, 49, 55, 52, 48, 50, 46, 44, 49, 51, 53],
  },
  {
    title: "Accessibility",
    desktop: [93, 93, 94, 92, 94, 93, 95, 94, 93, 95, 94, 96, 95, 94, 96, 95, 96, 94, 95, 96, 95, 96, 97, 96],
    mobile: [88, 89, 87, 90, 88, 91, 89, 90, 92, 90, 91, 89, 92, 91, 93, 92, 91, 93, 92, 94, 93, 92, 94, 93],
  },
  {
    title: "Best Practices",
    desktop: [74, 73, 75, 72, 74, 71, 73, 70, 72, 69, 71, 68, 70, 67, 69, 66, 68, 65, 67, 64, 66, 63, 65, 62],
    mobile: [61, 63, 60, 64, 62, 65, 63, 66, 64, 67, 65, 68, 66, 69, 67, 70, 68, 71, 69, 72, 70, 73, 71, 74],
  },
  {
    title: "SEO",
    desktop: [46, 45, 47, 44, 46, 43, 45, 42, 44, 41, 43, 40, 42, 39, 41, 38, 40, 37, 39, 36, 38, 37, 39, 38],
    mobile: [52, 51, 53, 50, 52, 49, 51, 48, 50, 47, 49, 46, 48, 45, 47, 44, 46, 45, 47, 46, 48, 47, 49, 48],
  },
];

export default function ScoreCardDemoPage() {
  const [density, setDensity] = useState<ScoreCardDensity>("small");

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-page)", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto 24px", color: "var(--text-body)", fontFamily: "var(--font-brand, system-ui, sans-serif)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>ScoreCard — demo</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, maxWidth: 640, lineHeight: 1.5 }}>
              Hover any chart to scrub the 24-day window: the numerals, the trend arrow beside each one,
              the Δ badge, the range label and the dot positions all follow the hovered index.
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0 0", maxWidth: 640, lineHeight: 1.5 }}>
              Two colour vocabularies are in play and they answer different questions. The numerals and the
              XSmall &ldquo;is&rdquo; chip are a health verdict, banded green / orange / red at 90 and 50, so
              they change as you scrub. Every chart mark — line, fill, hatch, range band, hover dot — is the
              series&rsquo; identity instead, fixed per device, so a line never changes hue with its own data.
              Direction is an arrow rather than a colour, and the delta and Δ figures carry their size in
              weight rather than in hue.
            </p>
          </div>
          <ScoreCardDensityControl value={density} onChange={setDensity} />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: density === "xsmall" ? 0 : 16,
          maxWidth: 1200,
          margin: "0 auto",
          border: density === "xsmall" ? "1px solid var(--border-hairline)" : undefined,
          borderRadius: density === "xsmall" ? 8 : undefined,
        }}
      >
        {CARDS.map((card) => (
          <div key={card.title} style={scoreCardFlexItemStyle(density)}>
            <ScoreCard data={card} density={density} />
          </div>
        ))}
      </div>
    </div>
  );
}
