---
name: seo-metadata
description: Add SEO and social-sharing metadata to a page. Use when the user asks to improve SEO, add meta tags, set the page title or description, or control how the page appears in search results or when shared on social media (Open Graph, Twitter cards).
---

# SEO metadata

Use this skill when a page needs search-engine and social-sharing metadata.

## Core tags

- `<title>` — concise, unique per page, under ~60 characters.
- `<meta name="description">` — a 1-2 sentence summary, under ~155 characters.
- `<link rel="canonical">` — the page's preferred absolute URL.
- `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Social sharing

Open Graph: `og:title`, `og:description`, `og:type`, `og:url`, `og:image`.
Twitter: `twitter:card` (usually `summary_large_image`), `twitter:title`, `twitter:description`, `twitter:image`.

## Guidance

- Keep the Open Graph title/description aligned with `<title>` and the meta description, but tuned for sharing.
- `og:image` must be an absolute URL; 1200x630 renders well across platforms.
- Do not reuse the same description across many pages — duplicate boilerplate hurts ranking.
