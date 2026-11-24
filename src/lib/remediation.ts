/**
 * What to do about a finding, written once.
 *
 * Every Lighthouse-derived case used to arrive with `remediation.steps = []`,
 * because the record the collector stores carries no steps. Accept refuses a case
 * with no steps, so the only path forward was Take on followed by a hand-written
 * plan — which is the main reason the Fix queue was empty while Decide held
 * sixteen rows.
 *
 * This map is the missing half of the classifier: `webflowPerformance` already
 * says what KIND of problem an audit is and who owns it; this says what to do
 * about it. Both are keyed by the audit id, which is a key rather than copy and
 * never reaches a reader — the case renders these steps, not the id.
 *
 * Three rules for an entry:
 *
 *   1. Name the actual change. "Make the first marquee image eager with
 *      fetchpriority=high and keep the rest lazy" is a step; "investigate" is
 *      not. A step a reader cannot start is a step that leaves the case in
 *      Decide.
 *   2. Webflow-aware where it can be. The customer edits in the Designer, in
 *      Site settings, in page settings — naming the surface is what makes a step
 *      actionable rather than aspirational.
 *   3. A success measure the next collection can read. It is what "Done when"
 *      shows and what the checkpoint judgement is made against, so it is a
 *      measurement, not a feeling.
 *
 * Precedence is NOT this module's: `fromRec` reads an explicit
 * `options.remediationSteps`, then `rec.agentIssue.remediation`, then this map.
 * A plan a person wrote for one case is applied later still, by
 * `applyCasePlans`, and it overrides everything here.
 */

export interface RemediationLibraryEntry {
  /** Ordered steps, in the order a person would do them. */
  steps: string[];
  /** What would prove it fixed — a reading the next run can compare. */
  successCriteria: string;
}

/**
 * The audits the production project's Decide queue holds, plus the ones the
 * 2026-11-23 audit says could become cases.
 *
 * Named as a list rather than only as keys of the map below, so the test that
 * every one of them has steps reads as the product statement it is — these are
 * the findings real projects actually get.
 */
export const PRODUCTION_AUDIT_IDS = [
  // Unused code and styles: the bulk of the queue.
  "unused-javascript",
  "unused-css-rules",
  // The four field-only cases, where the lab test reproduced nothing.
  "crux-field-only-lcp",
  "crux-field-only-inp",
  "crux-field-only-cls",
  "crux-field-only-ttfb",
  // Accessibility audits.
  "link-name",
  "link-descriptive",
  "heading-order",
  "label-content-name-mismatch",
  "color-contrast",
  "target-size",
  // Console and browser diagnostics.
  "errors-in-console",
  "devtools-issues",
  // Images.
  "unsized-images",
  // The audit's own largest causes, made visible in T6.
  "third-party-summary",
  "render-blocking-resources",
  "largest-contentful-paint-element",
  "lcp-lazy-loaded",
  "font-display",
  "uses-text-compression",
] as const;

const LIBRARY: Record<string, RemediationLibraryEntry> = {
  /* ── Unused code and styles ─────────────────────────────────────────── */

  "unused-javascript": {
    steps: [
      "Open the page in the Designer and list what runs on load: apps in the page settings, embeds, and anything added under Site settings → Custom code.",
      "Remove or delay the scripts the page does not use before a visitor interacts with it — analytics for other teams, old experiments, chat widgets that only matter after a click.",
      "Move code your own team owns into a separate file loaded with defer, rather than inline in the head.",
      "Publish, then wait for the next nightly collection and compare the transfer size in the evidence.",
    ],
    successCriteria: "Three nightly runs in a row report no unused script bytes on this page.",
  },

  "unused-css-rules": {
    steps: [
      "Find the stylesheet named in the evidence and check whether the page needs it above the first screenful.",
      "In Site settings → Custom code, move site-wide styles into a file that does not block the first paint, or split them so a page only downloads what it uses.",
      "Delete classes and style rules that nothing on the page uses.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "Three nightly runs in a row report no unused style bytes on this page.",
  },

  "unminified-javascript": {
    steps: [
      "Find the script named in the evidence under Site settings → Custom code or in the page settings.",
      "Replace the readable development copy with the published build, or turn on minification for it before publishing.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "The script transfers at its minified size on the next three nightly runs.",
  },

  "legacy-javascript": {
    steps: [
      "Identify the bundle named in the evidence — usually a polyfill bundle added for old browsers.",
      "Remove the polyfill bundle; current Chrome, Safari, Firefox and Edge do not need it.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "No legacy-transpiled code is reported on this page for three nightly runs.",
  },

  "bootup-time": {
    steps: [
      "Open the page in the Designer and find the scripts listed in the evidence.",
      "Delay third-party tags until after the page responds, and remove any script the page does not need.",
      "Split your own code so that only what the first screenful uses loads at startup.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "Total blocking time is under 200 ms on three consecutive nightly runs.",
  },

  "mainthread-work-breakdown": {
    steps: [
      "Open the evidence and note which kind of work dominates: scripts, styles, or layout.",
      "For scripts, delay or remove the ones named; for styles, move unused rules out of the first paint; for layout, simplify the deepest sections.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "Main-thread work falls under 2 s on three consecutive nightly runs.",
  },

  "dom-size": {
    steps: [
      "Open the deepest section named in the evidence and flatten wrapper divs that carry no style.",
      "Load sections far below the first screenful only when they come into view.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "The page holds fewer than 1,500 elements and nests no deeper than 32 levels for three nightly runs.",
  },

  /* ── Third-party code: the audit's largest single cause ─────────────── */

  "third-party-summary": {
    steps: [
      "List the third-party tags the page loads — Google Tag Manager, reCAPTCHA, the Facebook pixel, the chat or booking widget — and who asked for each one.",
      "Remove every tag nobody is using any more: an old pixel, a finished experiment, a duplicate tag manager.",
      "Set Google Tag Manager to load after the page is interactive, and move the Facebook pixel into it so one loader starts late instead of several.",
      "Load the chat or booking widget only on the pages that need it, or only when a visitor clicks to open it.",
      "Use the invisible reCAPTCHA on forms that are not above the first screenful.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "Third-party scripts transfer under 500 KiB and block the page for under 200 ms in three consecutive nightly runs.",
  },

  "third-party-facades": {
    steps: [
      "For each embed named in the evidence, show a still image instead of the live embed.",
      "Load the real embed only when a visitor clicks the image or when it scrolls into view.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "No third-party embed loads before a visitor interacts with it.",
  },

  /* ── The main thing visitors wait for ───────────────────────────────── */

  "largest-contentful-paint-element": {
    steps: [
      "Open the element named in the evidence — on the homepage it is the first image in the marquee.",
      "In the Designer, select that image and set its loading to Eager.",
      "Add a custom attribute fetchpriority=\"high\" to it so the browser requests it before anything else.",
      "Leave every other image in the slider lazy, and serve the image at the size it is shown.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "The main element is requested in the first 100 ms of the page load and Lighthouse reports it as the largest contentful paint on three consecutive runs.",
  },

  "lcp-lazy-loaded": {
    steps: [
      "In the Designer, select the image the evidence names — the first image of the homepage marquee — and set its loading to Eager.",
      "Keep the rest of the marquee lazy: only the first frame is visible without scrolling.",
      "Add the custom attribute fetchpriority=\"high\" to that image.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "The image is not lazily loaded in three consecutive Lighthouse runs.",
  },

  "prioritize-lcp-image": {
    steps: [
      "In the Designer, select the main image and set it to load eager.",
      "Add fetchpriority=\"high\" to it, and remove anything that reaches the image through a script or a style that arrives late.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "The main image is requested before any other image on the page.",
  },

  "lcp-discovery-insight": {
    steps: [
      "Check that the main image is an <img> in the page markup rather than a CSS background set by a delay-loaded script.",
      "If it is a background image, replace it with an image element in the Designer so the browser can find it while parsing the page.",
      "Publish and re-run the collection.",
    ],
    successCriteria: "The main image is discovered while the page is parsed, in three consecutive runs.",
  },

  "crux-field-only-lcp": {
    steps: [
      "Open the URL in the evidence on a real phone on a slow connection and note which element appears first.",
      "Load that element sooner: eager and fetchpriority=\"high\" if it is an image, and do not reach it through a script.",
      "Shrink the element — resize and compress the image — so it arrives sooner on a phone.",
      "Publish, then watch the Chrome UX Report for two 28-day windows.",
    ],
    successCriteria: "Real visitors' largest contentful paint (p75) is 2.5 s or less for two consecutive 28-day windows.",
  },

  "crux-field-only-inp": {
    steps: [
      "Replay the slowest interaction on a real phone: open the navigation, tap the primary button, open the form.",
      "Find the long task behind it — usually a third-party handler on click — and delay that tag until after the first interaction.",
      "Split event handlers so a tap runs only the code it needs.",
      "Publish, then watch the Chrome UX Report for two 28-day windows.",
    ],
    successCriteria: "Real visitors' interaction to next paint (p75) is 200 ms or less for two consecutive 28-day windows.",
  },

  "crux-field-only-cls": {
    steps: [
      "Open the page on a real phone and watch what moves while it loads: banners, cookie notices, fonts, images without reserved space.",
      "Reserve space for every image with a width and height, and for the consent banner with a fixed height before it is injected.",
      "Load the web font so text does not reflow when it arrives (font-display: swap plus a matching fallback).",
      "Publish, then watch the Chrome UX Report for two 28-day windows.",
    ],
    successCriteria: "Real visitors' cumulative layout shift (p75) is 0.1 or less for two consecutive 28-day windows.",
  },

  "crux-field-only-ttfb": {
    steps: [
      "Segment the server response by route and geography in the Chrome UX Report, or by asking visitors where they are.",
      "Check redirects on the way to the URL and remove any that are not needed.",
      "Turn on caching for the route at the hosting layer and make sure the page is served from an edge near those visitors.",
      "Publish, then watch the Chrome UX Report for two 28-day windows.",
    ],
    successCriteria: "Real visitors' time to first byte (p75) is 800 ms or less for two consecutive 28-day windows.",
  },

  /* ── Files that delay the first text ────────────────────────────────── */

  "render-blocking-resources": {
    steps: [
      "Open the file named in the evidence — on the homepage it is webfont.js, a 981 ms script in the head.",
      "In Site settings → Fonts, host the fonts on Webflow instead of loading them through webfont.js.",
      "Move any other blocking stylesheet out of the head and let Webflow bundle your site styles.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Nothing in the head blocks the first text for more than 100 ms in three consecutive runs.",
  },

  "render-blocking-insight": {
    steps: [
      "Open the files named in the evidence and check whether the first screenful needs each one.",
      "Move fonts and styles the first screenful does not need out of the blocking path.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Nothing in the head blocks the first text for more than 100 ms in three consecutive runs.",
  },

  "font-display": {
    steps: [
      "In Site settings → Fonts, host the site's fonts on Webflow rather than loading them from a third party.",
      "Show text in a fallback font until the web font arrives (font-display: swap) so no text is invisible while it loads.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "No text is held back waiting for a font in three consecutive runs.",
  },

  "uses-text-compression": {
    steps: [
      "Check whether the response named in the evidence is compressed with Brotli or gzip.",
      "On a Webflow-hosted site this is on by default; if the page sits behind a proxy or a custom domain handler, turn compression on there.",
      "Re-run the collection once the response is compressed.",
    ],
    successCriteria: "The HTML and its scripts are served compressed in three consecutive runs.",
  },

  /* ── Images ─────────────────────────────────────────────────────────── */

  "unsized-images": {
    steps: [
      "Open the images named in the evidence in the Designer.",
      "Set an explicit width and height on each one, so the space it needs is held open before it arrives.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "No image on the page shifts content when it loads, in three consecutive runs.",
  },

  "uses-responsive-images": {
    steps: [
      "Open the images named in the evidence and note the size they are shown at.",
      "Export each at twice the displayed size, no larger.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "No image transfers more than twice the bytes it needs at its displayed size.",
  },

  "uses-optimized-images": {
    steps: [
      "Open the images named in the evidence and re-export them compressed.",
      "Save them in WebP where the Designer will accept it.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "The images named transfer under 200 KB each in three consecutive runs.",
  },

  "modern-image-formats": {
    steps: [
      "Open the images named in the evidence and export them as WebP.",
      "Replace the originals in the Designer so the page does not fall back to the old format.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "The images named are served in WebP in three consecutive runs.",
  },

  "image-delivery-insight": {
    steps: [
      "Open the images named in the evidence.",
      "Resize each to the size it is shown at, compress it, and save it in the smallest format the site supports.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "The images named transfer under the size the evidence recommends in three consecutive runs.",
  },

  "webflow-image-unresponsive": {
    steps: [
      "In the Designer, set the image to a responsive width rather than a fixed pixel size.",
      "Export it at the largest size it is displayed at, so phones do not download the desktop version.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Phones download no more than the size they display.",
  },

  /* ── What screen-reader users meet ──────────────────────────────────── */

  "link-name": {
    steps: [
      "Select each link the evidence names in the Designer.",
      "Give it visible text, or an aria-label that says where it goes — an icon link with no text has no name.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Every link on the page announces a name to a screen reader in three consecutive runs.",
  },

  "link-descriptive": {
    steps: [
      "Find the links whose text is \"learn more\", \"click here\" or \"read more\" — the evidence names them.",
      "Rewrite each to say where it goes: \"Read the hosting guide\" rather than \"learn more\".",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "No link on the page is named only by a generic phrase in three consecutive runs.",
  },

  "heading-order": {
    steps: [
      "Open the page in the Designer and check the heading levels top to bottom: H1 first, then H2 for each section, H3 inside a section.",
      "Fix the headings that skip a level by choosing the right heading element in the style panel, not by changing the font size.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Heading levels descend one at a time on the page, in three consecutive runs.",
  },

  "label-content-name-mismatch": {
    steps: [
      "Find the controls the evidence names and compare their visible label with their accessible name.",
      "Make the accessible name start with the visible words: if the button reads \"Send\", its aria-label starts with \"Send\".",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Every labelled control's accessible name starts with its visible text.",
  },

  "color-contrast": {
    steps: [
      "Open the element the evidence names in the Designer and find its text colour and background.",
      "Change one of the two until the contrast is at least 4.5:1 for body text, or 3:1 for text 24px and larger.",
      "Check the same style in both the light and the dark section backgrounds.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "No text on the page falls below the WCAG AA contrast ratio in three consecutive runs.",
  },

  "target-size": {
    steps: [
      "Find the controls the evidence names — usually icon buttons in a footer or a slider.",
      "Give each one at least 24 by 24 pixels of tappable area by adding padding or a transparent hit area.",
      "Space neighbouring targets so two cannot be tapped by one finger.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Every tap target is at least 24 by 24 pixels with spacing, in three consecutive runs.",
  },

  /* ── The browser's own complaints ───────────────────────────────────── */

  "errors-in-console": {
    steps: [
      "Open the page in a browser and read the console — the evidence names the message.",
      "Fix the script or the request behind it: a missing file, a blocked request, a third-party tag that no longer exists.",
      "Remove tags that are failing and no longer used.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "The page logs no browser errors in three consecutive runs.",
  },

  "devtools-issues": {
    steps: [
      "Open the page in Chrome and read its Issues panel — the evidence names what Chrome reported.",
      "Fix each reported issue: blocked cookies, mixed content, a deprecation in your own or a third party's code.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Chrome reports no page issues in three consecutive runs.",
  },

  /* ── Webflow-native elements ────────────────────────────────────────── */

  "webflow-background-video": {
    steps: [
      "In the Designer, replace the background video with a still image where you can.",
      "Where it has to stay, load it only as it comes into view.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "The background video does not load before it is visible.",
  },

  "webflow-video-embed-eager": {
    steps: [
      "In the Designer, replace the YouTube or Vimeo player with a still image and a play button.",
      "Load the player only when a visitor clicks, or when it scrolls into view.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "The player loads only after a click in three consecutive runs.",
  },

  "webflow-video-embed-duplicate": {
    steps: [
      "In the Designer, find the two places the same video is embedded.",
      "Keep one player for the page and show a still image for the rest until somebody clicks.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "Each video player loads once per page.",
  },

  "webflow-lottie-eager": {
    steps: [
      "Export the animation smaller, and remove any frames a viewer never sees.",
      "In the Designer, load the animation only as it comes into view.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "No animation loads before it is visible.",
  },

  "webflow-spline-eager": {
    steps: [
      "Replace the 3D scene with a still image where you can.",
      "Otherwise load the scene only as it comes into view.",
      "Publish, then re-run the collection.",
    ],
    successCriteria: "The 3D scene loads only when it is visible.",
  },
};

/**
 * Titles that name one of the library's audits.
 *
 * Legacy records store Lighthouse's own title rather than the audit id, and the
 * catalogue in `webflowPerformance` already normalises a few of those into ids.
 * This is the same normalisation for the audits that only ever arrive as titles
 * — the accessibility and console ones — so a case finds its steps however it was
 * written.
 */
const TITLE_ALIASES: Record<string, string> = {
  "reduce unused javascript": "unused-javascript",
  "reduce unused css": "unused-css-rules",
  "reduce javascript execution time": "bootup-time",
  "minimize main thread work": "mainthread-work-breakdown",
  "avoid an excessive dom size": "dom-size",
  "reduce the impact of third party code": "third-party-summary",
  "largest contentful paint element": "largest-contentful-paint-element",
  "eliminate render blocking resources": "render-blocking-resources",
  "ensure text remains visible during webfont load": "font-display",
  "enable text compression": "uses-text-compression",
  "image elements do not have explicit width and height": "unsized-images",
  "properly size images": "uses-responsive-images",
  "serve images in next gen formats": "modern-image-formats",
  "links do not have a discernible name": "link-name",
  "links do not have descriptive text": "link-descriptive",
  "heading elements are not in a sequentially descending order": "heading-order",
  "elements with visible text labels do not have matching accessible names": "label-content-name-mismatch",
  "background and foreground colors do not have a sufficient contrast ratio": "color-contrast",
  "touch targets do not have sufficient size or spacing": "target-size",
  "browser errors were logged to the console": "errors-in-console",
  "issues were logged in the issues panel in chrome devtools": "devtools-issues",
  "investigate visitor-only content loading": "crux-field-only-lcp",
  "investigate visitor-only interaction delay": "crux-field-only-inp",
  "investigate visitor-only layout shifts": "crux-field-only-cls",
  "investigate visitor-only server response delay": "crux-field-only-ttfb",
};

function normalizedTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The steps for an audit, by id first and then by the title the record carries.
 *
 * Null when the library has nothing to say. That is a real answer rather than an
 * empty plan: an unknown audit keeps its case in Decide with Take on, and Accept
 * stays withdrawn until somebody writes the steps — rule 17's honest outcome,
 * rather than a generic "investigate" that pretends to be a plan.
 */
export function remediationFor(auditId: string, title?: string): RemediationLibraryEntry | null {
  const byId = LIBRARY[auditId.trim().toLowerCase()];
  if (byId) return byId;
  if (!title) return null;
  const aliased = TITLE_ALIASES[normalizedTitle(title)];
  return aliased ? LIBRARY[aliased] ?? null : null;
}

/** Every audit id the library holds steps for. */
export const REMEDIATION_AUDIT_IDS = Object.freeze(Object.keys(LIBRARY));
