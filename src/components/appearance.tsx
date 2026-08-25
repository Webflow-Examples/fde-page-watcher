"use client";

import { SegmentedControl } from "./segmented-control";

/**
 * Appearance: Auto, Light, or Dark.
 *
 * `data-surface` on `<html>` is what selects a theme block in globals.css.
 * Auto resolves against `prefers-color-scheme` at paint time and follows the
 * device afterwards; Light and Dark pin it regardless of the device.
 *
 * This module owns three things so they cannot drift apart: the stored values,
 * the resolution rule, and the script that applies the result before first
 * paint. The control itself is presentational — it takes a value and reports a
 * change, and the store decides how to persist it.
 */

export const APPEARANCES = ["auto", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

/** What actually gets written to `data-surface`. Auto is never a surface. */
export type Surface = "light" | "dark";

export const APPEARANCE_LABEL: Record<Appearance, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};

/** Shared with the pre-paint script below — keep the two in step. */
export const APPEARANCE_STORAGE_KEY = "page-watcher:appearance";

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}

/** Auto follows the device; anything else is what it says. */
export function resolveSurface(appearance: Appearance, prefersDark: boolean): Surface {
  if (appearance === "auto") return prefersDark ? "dark" : "light";
  return appearance;
}

/**
 * Runs synchronously before first paint, so the page never flashes the wrong
 * theme on load. Rendered via `dangerouslySetInnerHTML` — it must stay
 * dependency-free, side-effect-free beyond the attribute, and silent on
 * failure, because a throw here would block the document parse.
 *
 * Deliberately duplicates `resolveSurface` rather than importing it: this runs
 * before any bundle has loaded. `APPEARANCE_STORAGE_KEY` is interpolated so the
 * key itself cannot drift.
 */
export const APPEARANCE_PREPAINT_SCRIPT = `(function(){try{
var stored=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});
var pref=stored==="light"||stored==="dark"||stored==="auto"?stored:"auto";
var dark=pref==="dark"||(pref==="auto"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.setAttribute("data-surface",dark?"dark":"light");
}catch(e){}})();`;

const OPTIONS = APPEARANCES.map((value) => ({ value, label: APPEARANCE_LABEL[value] }));

export function AppearanceControl({
  value,
  onChange,
  className,
}: {
  value: Appearance;
  onChange: (next: Appearance) => void;
  className?: string;
}) {
  return (
    <SegmentedControl
      className={className}
      ariaLabel="Appearance"
      value={value}
      options={OPTIONS}
      onChange={(next) => onChange(next as Appearance)}
    />
  );
}
