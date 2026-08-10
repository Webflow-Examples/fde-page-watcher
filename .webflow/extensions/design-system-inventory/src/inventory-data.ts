/**
 * Fixed, bounded snapshot of the Page Watch design system, hand-derived from
 * project source on the date below. This is not live data: it is not
 * refetched, and it does not inspect Site Browser content or any network
 * source. Regenerate by re-reading the cited files if the source changes.
 *
 * Evidence:
 * - Tokens:      src/app/globals.css (":root" custom properties)
 * - Components:  src/components/*.tsx (exported component/hook names)
 * - Patterns:    recurring UI conventions named in docs/visual-inventory.md
 *                and confirmed by grep across src/app/**\/page.tsx
 * - Usage links: exact route files that import or render each piece
 *
 * Snapshot date: reconciled against source on the same day as
 * docs/visual-inventory.md (August 4, 2026).
 */

export type SystemCategory = "token" | "pattern" | "component";

export interface UsageRef {
  /** App route path as a human-readable location. */
  route: string;
  /** Source file backing that route, for traceability. */
  file: string;
}

export type PreviewKind =
  | { kind: "swatch"; colors: { hex: string; label: string }[] }
  | { kind: "scale"; steps: { value: string; label: string }[] }
  | { kind: "type"; sample: string }
  | { kind: "mock"; mockId: string };

export interface SystemEntry {
  id: string;
  category: SystemCategory;
  name: string;
  description: string;
  /** Source file where this piece is defined. */
  source: string;
  usages: UsageRef[];
  /** Bounded visual preview, sourced from the same real token/pattern values. */
  preview: PreviewKind;
}

const ROUTES: Record<string, { route: string; file: string }> = {
  dashboard: { route: "/dashboard", file: "src/app/(app)/dashboard/page.tsx" },
  pages: { route: "/pages (redirects to /dashboard)", file: "src/app/(app)/pages/page.tsx" },
  pageDetail: { route: "/pages/[id]", file: "src/app/(app)/pages/[id]/page.tsx" },
  inbox: { route: "/inbox", file: "src/app/(app)/inbox/page.tsx" },
  tasks: { route: "/tasks", file: "src/app/(app)/tasks/page.tsx" },
  escalations: { route: "/escalations", file: "src/app/(app)/escalations/page.tsx" },
  watchlist: { route: "/watchlist", file: "src/app/(app)/watchlist/page.tsx" },
  settings: { route: "/settings (shares /watchlist implementation)", file: "src/app/(app)/settings/page.tsx" },
  layout: { route: "app shell (every route)", file: "src/app/(app)/layout.tsx" },
};

function refs(...keys: (keyof typeof ROUTES)[]): UsageRef[] {
  return keys.map((k) => ROUTES[k]);
}

export const INVENTORY: SystemEntry[] = [
  // ---- Tokens -----------------------------------------------------------
  // CSS custom properties are consumed only inside globals.css itself
  // (as `var(--x)` inside other rules); routes/components use Tailwind
  // utility classes or the semantic --wf-* names rather than referencing
  // --bg/--panel/etc. directly. Usage below reflects in-stylesheet
  // reference counts, since that is the only place these are consumed.
  {
    id: "token-bg",
    category: "token",
    name: "--bg / --bg-elev",
    description: "Near-black page canvas and slightly lighter elevated surface.",
    source: "src/app/globals.css",
    usages: [{ route: "compiled into every route's canvas background", file: "src/app/globals.css" }],
    preview: { kind: "swatch", colors: [{ hex: "#0b0b0c", label: "--bg" }, { hex: "#0e0e10", label: "--bg-elev" }] },
  },
  {
    id: "token-panel",
    category: "token",
    name: "--panel / --panel-2",
    description: "Two closely spaced card/panel surface tones.",
    source: "src/app/globals.css",
    usages: [{ route: "compiled into every card and panel", file: "src/app/globals.css" }],
    preview: { kind: "swatch", colors: [{ hex: "#131315", label: "--panel" }, { hex: "#161619", label: "--panel-2" }] },
  },
  {
    id: "token-border",
    category: "token",
    name: "--border / --border-2",
    description: "Low-contrast one-pixel card and divider borders.",
    source: "src/app/globals.css",
    usages: [{ route: "compiled into every card, table, and divider", file: "src/app/globals.css" }],
    preview: { kind: "swatch", colors: [{ hex: "#1e1e22", label: "--border" }, { hex: "#26262a", label: "--border-2" }] },
  },
  {
    id: "token-text",
    category: "token",
    name: "--text / --text-dim / --text-muted / --text-faint",
    description: "Four-step text color scale from primary copy to faint metadata.",
    source: "src/app/globals.css",
    usages: [{ route: "compiled into all typography", file: "src/app/globals.css" }],
    preview: {
      kind: "swatch",
      colors: [
        { hex: "#f4f4f5", label: "--text" },
        { hex: "#c4c4c8", label: "--text-dim" },
        { hex: "#8a8a90", label: "--text-muted" },
        { hex: "#6c6c72", label: "--text-faint" },
      ],
    },
  },
  {
    id: "token-accent",
    category: "token",
    name: "--accent / --wf-blue family",
    description: "Primary blue: active navigation, primary actions, selected filters.",
    source: "src/app/globals.css",
    usages: [{ route: "primary actions and selection states across every route", file: "src/app/globals.css" }],
    preview: {
      kind: "swatch",
      colors: [
        { hex: "#146ef5", label: "--accent" },
        { hex: "#3b89ff", label: "--accent-bright" },
        { hex: "#69a8ff", label: "--wf-blue-300" },
      ],
    },
  },
  {
    id: "token-green",
    category: "token",
    name: "--green / --wf-green-300",
    description: "Healthy scores, success states, completed tasks, custom markers.",
    source: "src/app/globals.css",
    usages: [{ route: "score bands, task Done state, toasts", file: "src/app/globals.css" }],
    preview: { kind: "swatch", colors: [{ hex: "#35d07f", label: "--green" }, { hex: "#51e778", label: "--wf-green-300" }] },
  },
  {
    id: "token-amber",
    category: "token",
    name: "--amber / --wf-yellow family",
    description: "Measured impact, slow/active findings, warnings, partial states.",
    source: "src/app/globals.css",
    usages: [{ route: "warning banners and partial-remediation chips", file: "src/app/globals.css" }],
    preview: {
      kind: "swatch",
      colors: [
        { hex: "#ff9a3d", label: "--amber" },
        { hex: "#ffad0d", label: "--wf-yellow" },
        { hex: "#ffc857", label: "--wf-yellow-300" },
      ],
    },
  },
  {
    id: "token-red",
    category: "token",
    name: "--red / --wf-red-300",
    description: "Regressions, failing checks, product gaps, destructive actions.",
    source: "src/app/globals.css",
    usages: [{ route: "regression states and destructive controls", file: "src/app/globals.css" }],
    preview: { kind: "swatch", colors: [{ hex: "#ff5c6c", label: "--red" }, { hex: "#ff6b78", label: "--wf-red-300" }] },
  },
  {
    id: "token-violet",
    category: "token",
    name: "--violet / --wf-purple family",
    description: "Culprit labels, agent-ignore state, task-linked markers.",
    source: "src/app/globals.css",
    usages: [{ route: "culprit rollups and agent-ignore badges", file: "src/app/globals.css" }],
    preview: {
      kind: "swatch",
      colors: [
        { hex: "#8a5cf6", label: "--violet" },
        { hex: "#a78bfa", label: "--wf-purple-300" },
        { hex: "#c4b5fd", label: "--wf-purple-200" },
      ],
    },
  },
  {
    id: "token-font",
    category: "token",
    name: "--font-brand (WF Visual Sans)",
    description: "Webflow's variable brand typeface with system sans fallback.",
    source: "src/app/globals.css",
    usages: [{ route: "applied to <body>, inherited by every route", file: "src/app/globals.css" }],
    preview: { kind: "type", sample: "Page Watch" },
  },
  {
    id: "token-radius-scale",
    category: "token",
    name: "Radius scale (unnamed)",
    description:
      "Not a declared --radius-* custom property: a recurring two-band scale inferred from 23 border-radius call sites in globals.css — 6–8px for controls, 10–14px for cards and panels.",
    source: "src/app/globals.css (border-radius declarations, not a token)",
    usages: [{ route: "controls (6–8px) and cards/panels (10–14px) sitewide", file: "src/app/globals.css" }],
    preview: {
      kind: "scale",
      steps: [
        { value: "6px", label: "control radius" },
        { value: "8px", label: "control radius (lg)" },
        { value: "10px", label: "card radius" },
        { value: "14px", label: "panel radius" },
      ],
    },
  },
  {
    id: "token-layout-spacing",
    category: "token",
    name: "Layout spacing (unnamed)",
    description:
      "Not a declared --space-* custom property: documented layout geometry reused as \"the same alignment line\" — a 244px sidebar width and 40px main-content horizontal padding.",
    source: "docs/visual-inventory.md (Global visual language / Canvas and surfaces)",
    usages: [{ route: "sidebar width and main-page header/content padding sitewide", file: "docs/visual-inventory.md" }],
    preview: {
      kind: "scale",
      steps: [
        { value: "244px", label: "sidebar width" },
        { value: "40px", label: "content padding" },
      ],
    },
  },

  // ---- Patterns -----------------------------------------------------------
  {
    id: "pattern-segmented-control",
    category: "pattern",
    name: "Segmented control",
    description: "Rounded group with a sliding indicator for switching device, grouping, filter, or view.",
    source: "src/components/segmented-control.tsx",
    usages: refs("dashboard", "pageDetail", "watchlist", "escalations", "inbox", "tasks"),
    preview: { kind: "mock", mockId: "segmented-control" },
  },
  {
    id: "pattern-select-menu",
    category: "pattern",
    name: "Select menu (date range)",
    description: "Portaled listbox combobox used to choose a date range without native select styling.",
    source: "src/components/select-menu.tsx",
    usages: refs("dashboard", "pageDetail"),
    preview: { kind: "mock", mockId: "select-menu" },
  },
  {
    id: "pattern-classification-chips",
    category: "pattern",
    name: "Classification chips",
    description: "Weighted metric, culprit, and remediation chips explaining a recommendation.",
    source: "src/components/bits.tsx (WebflowClassificationChips)",
    usages: refs("dashboard", "inbox", "tasks", "pageDetail", "escalations"),
    preview: { kind: "mock", mockId: "classification-chips" },
  },
  {
    id: "pattern-field-evidence-chip",
    category: "pattern",
    name: "Field-evidence chip",
    description: "States how lab measurements relate to real visitor (CrUX) evidence.",
    source: "src/components/bits.tsx (FieldEvidenceChip)",
    usages: refs("dashboard", "inbox", "pageDetail", "tasks"),
    preview: { kind: "mock", mockId: "field-evidence-chip" },
  },
  {
    id: "pattern-status-shape",
    category: "pattern",
    name: "Status shape + color",
    description: "Circle/triangle/square shape paired with semantic color so status is never color-only.",
    source: "src/components/bits.tsx (StatusShape, StatusBadge)",
    usages: refs("dashboard", "inbox", "pageDetail", "tasks"),
    preview: { kind: "mock", mockId: "status-shape" },
  },
  {
    id: "pattern-sort-header",
    category: "pattern",
    name: "Sortable column header",
    description: "Header button with an ascending/descending indicator; first click sorts descending.",
    source: "src/components/bits.tsx (SortHeader)",
    usages: refs("dashboard", "inbox", "tasks"),
    preview: { kind: "mock", mockId: "sort-header" },
  },
  {
    id: "pattern-modal-shell",
    category: "pattern",
    name: "Modal shell",
    description: "Dark scrim, centered dialog, focus trap, Escape-to-close, shared by add/marker/report dialogs.",
    source: "src/components/overlays.tsx (ChromeOverlays)",
    usages: refs("layout"),
    preview: { kind: "mock", mockId: "modal-shell" },
  },
  {
    id: "pattern-toast",
    category: "pattern",
    name: "Toast",
    description: "Fixed bottom-center ARIA live status confirming a mutation or reporting a recoverable failure.",
    source: "src/components/overlays.tsx (ChromeOverlays)",
    usages: refs("layout"),
    preview: { kind: "mock", mockId: "toast" },
  },
  {
    id: "pattern-empty-state",
    category: "pattern",
    name: "Honest empty / pending state",
    description: "Words and em dashes instead of fabricated zero scores; distinct pending/no-baseline copy.",
    source: "src/app/(app)/pages/[id]/page.tsx and src/app/(app)/inbox/page.tsx",
    usages: refs("pageDetail", "inbox", "escalations"),
    preview: { kind: "mock", mockId: "empty-state" },
  },

  // ---- Components -----------------------------------------------------------
  {
    id: "component-sidebar",
    category: "component",
    name: "Sidebar",
    description: "Persistent navigation shell: brand, nav list with count badges, nightly run card.",
    source: "src/components/Sidebar.tsx",
    usages: refs("layout"),
    preview: { kind: "mock", mockId: "sidebar" },
  },
  {
    id: "component-chrome-overlays",
    category: "component",
    name: "ChromeOverlays",
    description: "Hosts the global toast and the add-page / change-marker / full-report dialogs.",
    source: "src/components/overlays.tsx",
    usages: refs("layout"),
    preview: { kind: "mock", mockId: "modal-shell" },
  },
  {
    id: "component-segmented-control",
    category: "component",
    name: "SegmentedControl / StatusSegmentedControl / DeviceSegmentedControl",
    description: "Underlying React components behind the segmented-control pattern.",
    source: "src/components/segmented-control.tsx",
    usages: refs("dashboard"),
    preview: { kind: "mock", mockId: "segmented-control" },
  },
  {
    id: "component-seg-toggle",
    category: "component",
    name: "SegToggle",
    description: "Thin wrapper around SegmentedControl for strategy, group-by, and view switches.",
    source: "src/components/bits.tsx",
    usages: refs("watchlist", "escalations", "inbox", "tasks", "pageDetail"),
    preview: { kind: "mock", mockId: "segmented-control" },
  },
  {
    id: "component-select-menu",
    category: "component",
    name: "SelectMenu",
    description: "React implementation of the select-menu pattern.",
    source: "src/components/select-menu.tsx",
    usages: refs("dashboard", "pageDetail"),
    preview: { kind: "mock", mockId: "select-menu" },
  },
  {
    id: "component-sparkline",
    category: "component",
    name: "Sparkline",
    description: "Small inline trend line used in table cells and score cards.",
    source: "src/components/charts.tsx",
    usages: refs("dashboard", "pageDetail"),
    preview: { kind: "mock", mockId: "sparkline" },
  },
  {
    id: "component-history-chart",
    category: "component",
    name: "HistoryChart",
    description: "Stacked desktop/mobile score-over-time chart with medians, baselines, and anomaly bands.",
    source: "src/components/charts.tsx",
    usages: refs("pageDetail"),
    preview: { kind: "mock", mockId: "history-chart" },
  },
  {
    id: "component-agent-readiness-chart",
    category: "component",
    name: "AgentReadinessChart",
    description: "Historical agent-readiness percentage chart with point-level inspection.",
    source: "src/components/charts.tsx",
    usages: refs("pageDetail"),
    preview: { kind: "mock", mockId: "agent-readiness-ring" },
  },
  {
    id: "component-status-badge",
    category: "component",
    name: "StatusBadge",
    description: "Renders a status label with its paired shape and semantic color.",
    source: "src/components/bits.tsx",
    usages: refs("dashboard", "inbox", "pageDetail", "tasks"),
    preview: { kind: "mock", mockId: "status-shape" },
  },
  {
    id: "component-field-evidence-chip",
    category: "component",
    name: "FieldEvidenceChip",
    description: "React implementation of the field-evidence chip pattern.",
    source: "src/components/bits.tsx",
    usages: refs("dashboard", "inbox", "pageDetail", "tasks"),
    preview: { kind: "mock", mockId: "field-evidence-chip" },
  },
  {
    id: "component-webflow-classification-chips",
    category: "component",
    name: "WebflowClassificationChips",
    description: "React implementation of the classification chips pattern.",
    source: "src/components/bits.tsx",
    usages: refs("dashboard", "escalations", "inbox", "pageDetail", "tasks"),
    preview: { kind: "mock", mockId: "classification-chips" },
  },
  {
    id: "component-sort-header",
    category: "component",
    name: "SortHeader",
    description: "React implementation of the sortable column header pattern.",
    source: "src/components/bits.tsx",
    usages: refs("dashboard", "inbox", "tasks"),
    preview: { kind: "mock", mockId: "sort-header" },
  },
  {
    id: "component-webflow-connection",
    category: "component",
    name: "WebflowConnection",
    description: "Connect/disconnect card for the Webflow Enterprise site activity integration.",
    source: "src/components/webflow-connection.tsx",
    usages: refs("watchlist"),
    preview: { kind: "mock", mockId: "webflow-connection" },
  },
  {
    id: "component-visitor-experience-panel",
    category: "component",
    name: "VisitorExperiencePanel",
    description: "Compares lab medians to rolling 28-day Chrome UX Report field data.",
    source: "src/components/visitor-experience.tsx",
    usages: refs("pageDetail"),
    preview: { kind: "mock", mockId: "visitor-experience" },
  },
  {
    id: "component-icons",
    category: "component",
    name: "Icon set (icons.tsx)",
    description: "Shared inline SVG icon components: logo, nav, device, action, and chevron glyphs.",
    source: "src/components/icons.tsx",
    usages: refs("layout", "dashboard", "pageDetail", "watchlist", "inbox", "tasks", "escalations"),
    preview: { kind: "mock", mockId: "icon-set" },
  },
  {
    id: "component-store",
    category: "component",
    name: "StoreProvider / useStore",
    description: "Shared application state and mutation behavior (optimistic updates, toasts) used by every route.",
    source: "src/components/store.tsx",
    usages: refs("layout", "dashboard", "pageDetail", "watchlist", "inbox", "tasks", "escalations"),
    preview: { kind: "mock", mockId: "store" },
  },
];

export function usageCount(entry: SystemEntry): number {
  return entry.usages.length;
}
