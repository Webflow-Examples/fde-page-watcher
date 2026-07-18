import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

const base = (size: number, style?: CSSProperties): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  style,
});

export function LogoMark({ size = 17, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
      <path d="M24 4.5l-6.2 15h-4.3l-2.6-8-2.9 8H3.9L0 4.5h4.3l2.1 9 2.9-9h3.7l2.6 9 2.2-9H24z" />
    </svg>
  );
}

export function DashboardIcon({ size = 17, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={1.6}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

export function InboxIcon({ size = 17, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={1.6}>
      <path d="M4 13h4l2 3h4l2-3h4" />
      <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
      <path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

export function TasksIcon({ size = 17, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={1.6}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function EyeIcon({ size = 17, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={1.6}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ClockIcon({ size = 15, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PlusIcon({ size = 15, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon({ size = 15, style }: IconProps) {
  return (
    <svg {...base(size, style)}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

export function ExternalIcon({ size = 15, style }: IconProps) {
  return (
    <svg {...base(size, style)}>
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function MobileIcon({ size = 13, style }: IconProps) {
  return (
    <svg {...base(size, style)}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function DesktopIcon({ size = 13, style }: IconProps) {
  return (
    <svg {...base(size, style)}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

export function RefreshIcon({ size = 15, style }: IconProps) {
  return (
    <svg {...base(size, style)}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={2}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function CheckIcon({ size = 16, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={2.2}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function CloseIcon({ size = 15, style }: IconProps) {
  return (
    <svg {...base(size, style)} strokeWidth={2}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
