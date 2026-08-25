import type { Digest, DigestLine } from "./digest";

/**
 * The digest as a message.
 *
 * The only template there is. It renders what `buildDigest` derived and decides
 * nothing: no section is added or dropped here, no sentence is written here, and
 * no link is composed here. That is what makes the verification tractable — the
 * template cannot reference a destination the app retired, because it does not
 * name a destination at all. Every href it renders was built from
 * `DESTINATION_PATH`, one layer up.
 *
 * Two bodies, from one model. The plain-text body is not a fallback: a digest
 * that reads correctly as text is a digest whose sentences carry their own
 * meaning, and every client that strips the HTML gets the same message rather
 * than a worse one.
 *
 * The HTML names no colour. Not because a token could be used instead — a mail
 * client does not resolve custom properties, which is why `manifest.ts` is
 * carved out of the no-hex rule — but because a hard-coded light-theme grey is
 * the wrong answer to the question the carve-out would be granted for. A reader
 * in a dark mail client would get pale text on their client's dark background,
 * and no token edit could fix it. Every colour here is therefore the client's,
 * which is the only one that knows what the reader is looking at. What the
 * template does own is structure and scale, and those are enough: the sections
 * are headings, the lines are a list, and the footer is smaller.
 */

export interface DigestMessage {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}

/**
 * One line, as text.
 *
 * The URL goes on its own line under the sentence rather than inside it. A
 * plain-text digest that splices a URL into a sentence produces a sentence
 * nobody can read and a URL half the clients will not linkify.
 */
function textLine(line: DigestLine): string {
  return `- ${line.text}\n  ${line.href}`;
}

function htmlLine(line: DigestLine): string {
  return `<li style="margin:0 0 10px">${escapeHtml(line.text)} <a href="${escapeHtml(line.href)}">Open</a></li>`;
}

/**
 * The heading scale, as sizes rather than levels alone.
 *
 * Registry rule 8's floor applies here as much as on a screen: nothing carrying
 * meaning renders below 12px, and a section heading is what tells the reader
 * which of the four they are in.
 */
const SECTION_HEADING_STYLE = "margin:22px 0 8px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase";
const FOOTER_STYLE = "margin:28px 0 0;font-size:12.5px";

export function renderDigestMessage(digest: Digest): DigestMessage {
  const text = [
    digest.subject,
    "",
    ...digest.sections.flatMap((section) => [
      section.heading,
      ...section.lines.map(textLine),
      "",
    ]),
    `${digest.footer.text}\n${digest.footer.href}`,
  ].join("\n");

  const html = [
    "<!doctype html><html><body style=\"margin:0;padding:24px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif\">",
    `<h1 style="margin:0 0 20px;font-size:17px;font-weight:600">${escapeHtml(digest.subject)}</h1>`,
    ...digest.sections.map((section) => [
      `<h2 style="${SECTION_HEADING_STYLE}">${escapeHtml(section.heading)}</h2>`,
      `<ul style="margin:0;padding:0 0 0 18px">${section.lines.map(htmlLine).join("")}</ul>`,
    ].join("")),
    `<p style="${FOOTER_STYLE}">${escapeHtml(digest.footer.text)} <a href="${escapeHtml(digest.footer.href)}">Settings</a></p>`,
    "</body></html>",
  ].join("");

  return { subject: digest.subject, text, html };
}

/** Every address the message points at, for the test that checks all of them. */
export function digestLinks(digest: Digest): string[] {
  return [...digest.sections.flatMap((section) => section.lines.map((line) => line.href)), digest.footer.href];
}
