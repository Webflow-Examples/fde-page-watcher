---
name: responsive-design
description: Build responsive, mobile-first layouts that adapt across breakpoints. Use when the user asks for responsive, mobile-friendly, or adaptive layouts, or mentions phones, tablets, breakpoints, or how a page looks on different screen sizes.
---

# Responsive design

Use this skill when a page or component needs to work well across screen sizes.

## Approach

1. Design mobile-first: write the base layout for the smallest target width, then layer on styles at larger breakpoints.
2. Prefer fluid units (`%`, `rem`, `clamp()`, `min()`, `max()`) and CSS grid/flexbox over fixed pixel widths.
3. Use a small, consistent breakpoint set rather than ad-hoc values. A reasonable default: 480px (mobile), 768px (tablet), 1024px (desktop), 1280px (wide).
4. Make typography fluid with `clamp()` so text scales smoothly between breakpoints.
5. Keep interactive tap targets at least 44x44px on touch layouts.

## Checklist

- No horizontal scrolling at any target width.
- Images and media use `max-width: 100%` and scale within their container.
- Content reflows (stacks columns, collapses navigation) at narrow widths instead of only shrinking.
- Verify the layout at 360px, 768px, and 1280px.
