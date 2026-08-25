import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
  /**
   * A token string — `var(--action-destructive-text)` — never a literal.
   *
   * It is applied through `style`, not through the SVG `stroke`/`fill`
   * presentation attribute: `var()` is a CSS value and does not resolve in an
   * attribute, so `stroke="var(--x)"` paints nothing at all.
   *
   * The prop exists because Phosphor exports icons under three of the names
   * below (`TrashIcon`, `PlusIcon`, `CheckIcon`) and *does* accept `color`.
   * Before this, a call site that switched imports — or a rewrite of a
   * `color=` attribute that did not check which import was in scope —
   * compiled clean and silently dropped the colour.
   */
  color?: string;
}

const base = (
  size: number,
  style?: CSSProperties,
  color?: string,
): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  // `stroke` stays `currentColor` so the common case — a caller setting
  // `color` on an ancestor, or passing `style={{ color: "var(--…)" }}` —
  // keeps working untouched. An explicit `color` overrides it from `style`,
  // where a `var()` reference actually resolves.
  style: color ? { ...style, stroke: color } : style,
});

export function LogoMark({ size = 17, style, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={color ? { ...style, fill: color } : style}>
      <path d="M24 4.5l-6.2 15h-4.3l-2.6-8-2.9 8H3.9L0 4.5h4.3l2.1 9 2.9-9h3.7l2.6 9 2.2-9H24z" />
    </svg>
  );
}

export function DashboardIcon({ size = 17, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={1.6}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

export function PagesIcon({ size = 17, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={1.6}>
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M15 3v5h4M10 12h6M10 16h6" />
      <path d="M4 6v15" />
    </svg>
  );
}

export function InboxIcon({ size = 17, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={1.6}>
      <path d="M4 13h4l2 3h4l2-3h4" />
      <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
      <path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

export function TasksIcon({ size = 17, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={1.6}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function EyeIcon({ size = 17, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={1.6}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ClockIcon({ size = 15, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PlusIcon({ size = 15, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon({ size = 15, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

export function ExternalIcon({ size = 15, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)}>
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function RefreshIcon({ size = 15, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 14, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={2}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function CheckIcon({ size = 16, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={2.2}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function CloseIcon({ size = 15, style, color }: IconProps) {
  return (
    <svg {...base(size, style, color)} strokeWidth={2}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
