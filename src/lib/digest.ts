import { disagreedCheckpointOf, noReadingTaken } from "./checkpoint-evaluation";
import { normalizeCollectionSchedule } from "./collectionSchedule";
import {
  DIGEST_SECTION_HEADING,
  digestFooter,
  digestLineBack,
  digestLineDecide,
  digestLineHeld,
  digestLineNoCheck,
  digestOpenSince,
  digestSubject,
} from "./digest-copy";
import { normalizeDigestCadence, type DigestCadence } from "./digestCadence";
import { formatImpact, partitionByImpact } from "./impact-format";
import { includedPages, queueOf, type IssueCase } from "./issue-case";
import { absoluteUrl, casePath } from "./paths";
import { normalizePerformanceThresholds } from "./performanceThresholds";
import { pageScopeOf } from "./scope-line";
import { daysUntil } from "./watch-copy";
import type { AppState, CollectionSchedule, PerformanceThresholds, WatchPage } from "./types";
import { DESTINATION_PATH } from "./vocabulary";
import { isPageActivelyMonitored } from "./watchCapacity";

/**
 * One digest: what the collector's run found, in the order a reader needs it.
 *
 * A message is built for every run, including the runs that found nothing. That
 * is the whole design, and everything else follows from it:
 *
 *   - Because a quiet run still sends, an absent message can only mean an absent
 *     run. That is the one diagnostic a nightly job can give a reader for free,
 *     and it only holds if the footer says how often to expect one — which is
 *     why the footer is not decoration.
 *   - Because the message is the whole channel, there is no instant one. A
 *     collector that runs once a night has nothing to be instant about; a
 *     real-time alert on a nightly reading is a notification about a cron job.
 *   - Because there is one message per site, there is one setting: how often.
 *     It is S8's, and it is the only one there will be.
 *
 * The four sections are fixed in order and omitted when empty. An empty section
 * rendered as a heading with nothing under it reads as a measurement that found
 * nothing, which is the reading rule 18 spends its length forbidding.
 *
 * Two rules do most of the work here, and they pull in opposite directions:
 *
 *   Rule 18. An absent reading withholds the claim that rested on it and
 *   nothing else. A fix that came back is still reported when the saving could
 *   not be measured; it just does not claim a number. Nothing in this module
 *   throws on an absent value — a malformed shape fails loudly where it is
 *   built (`nightScore` in `scoring.ts` names the night and the category), but a
 *   digest that crashed rather than omitting a clause would have traded a false
 *   claim for no message, which is the one outcome the design is arranged
 *   against.
 *
 *   Rule 19. Every figure is a measurement in the unit it was measured in, and a
 *   figure standing for several cases is the worst reading one of them produced
 *   rather than a sum. A digest is the easiest place in a product to invent a
 *   number nobody can click through to check.
 *
 * No composite score appears anywhere, and none can: every number in the message
 * comes from `impact-format`, which formats one reading at a time.
 */

/* ── The shape ──────────────────────────────────────────────────────────── */

/**
 * The four sections, in the order they are rendered.
 *
 * The order is an argument. What came back is first because a fix that did not
 * hold is the only thing in the message that overturns something the reader
 * already believed. What needs deciding is next because it is work. What is
 * holding is third because it is reassurance. What could not be measured is last
 * because it is the absence of news, and news beats its absence.
 */
export const DIGEST_SECTIONS = ["came_back", "to_decide", "held", "could_not_measure"] as const;
export type DigestSectionKind = (typeof DIGEST_SECTIONS)[number];

export interface DigestLine {
  /** One sentence. Always. */
  text: string;
  /** Where the sentence goes. Always. */
  href: string;
  /**
   * The case this line is about, when it is about one.
   *
   * Absent on the Held line, which is a count rather than a case. That is the
   * only one, and it is why the field exists: it is what decides whether a link
   * may be a queue, rather than a convention each caller is asked to remember.
   */
  caseId?: string;
}

export interface DigestSection {
  kind: DigestSectionKind;
  heading: string;
  lines: DigestLine[];
}

export interface Digest {
  site: string;
  /** The collection cohort's calendar day, as the reader's timezone cut it. */
  date: string;
  cadence: DigestCadence;
  subject: string;
  /** Non-empty sections only, in `DIGEST_SECTIONS` order. */
  sections: DigestSection[];
  footer: DigestLine;
  /** The count the subject reads, kept so a caller need not recount. */
  cameBack: number;
}

export interface DigestInput {
  site: string;
  date: string;
  cadence: DigestCadence;
  cases: readonly IssueCase[];
  pages: readonly WatchPage[];
  thresholds: PerformanceThresholds;
  /** For the footer's "measured at", which is the run's own schedule. */
  schedule?: CollectionSchedule;
  /**
   * The app's public URL, so links work from a mail client.
   *
   * Empty is allowed and produces root-relative links. That is wrong in an email
   * and visibly wrong, which is the point: a deployment that has not been told
   * its own address should send a link that obviously does not work rather than
   * one that quietly resolves against whatever origin opened it.
   */
  appUrl: string;
  locale?: string;
}

/* ── Naming the site ────────────────────────────────────────────────────── */

/**
 * The site this digest is about.
 *
 * The host of the first page on the watchlist, which is the site the project
 * watches — a project's pages are pages of one site, so the first one names it.
 * `www.` comes off because nobody says it. A URL that will not parse is used as
 * it stands: a subject line carrying a raw URL is ugly and true, which beats a
 * tidy invented name.
 */
export function digestSiteOf(state: Pick<AppState, "pages">): string {
  const page = state.pages.find(isPageActivelyMonitored) ?? state.pages[0];
  if (!page) return "";
  try {
    return new URL(page.url).hostname.replace(/^www\./, "");
  } catch {
    return page.url;
  }
}

/* ── Which section a case belongs in ────────────────────────────────────── */

/**
 * Which section a case belongs in, or null when it belongs in none.
 *
 * Every case lands in at most one. That matters more than it looks: a case in
 * two sections would be counted twice by the subject, and a Held count that
 * included the fixes whose checks could not be taken would be reassurance built
 * from the cases with no evidence at all.
 *
 * `disagreedCheckpointOf` is what separates a fix that came back from a case
 * somebody reopened by hand, and it lives in `checkpoint-evaluation` because
 * that module is the only thing in the app permitted to read a checkpoint
 * result. A second reader is how the five evaluation rules drift.
 *
 * A case with nothing outstanding — resolved, dismissed — is in no section. The
 * digest is not a report on the project; it is what happened and what is
 * waiting.
 */
export function digestSectionOf(issue: IssueCase): DigestSectionKind | null {
  const queue = queueOf(issue.state);
  if (queue === "decide") return disagreedCheckpointOf(issue) ? "came_back" : "to_decide";
  if (queue === "watch") return noReadingTaken(issue) ? "could_not_measure" : "held";
  return null;
}

/* ── Reading a page ─────────────────────────────────────────────────────── */

/**
 * When a page last produced a reading.
 *
 * Its newest night, falling back to the last time a run finished. Null when it
 * has never answered at all — which is not the same as answering long ago, and
 * is why this returns null rather than a very large number of days.
 */
function lastAnsweredAt(page: WatchPage): string | undefined {
  const newest = page.history.at(-1)?.date;
  return newest ?? page.lastRunAt;
}

/**
 * Whole days since a page last answered, or null when it never has.
 *
 * Counted from the cohort's own day rather than the wall clock, so a digest
 * built twice for the same night says the same number. `daysUntil` is W1's, and
 * it collapses both instants to their calendar day before subtracting — the same
 * reason the checkpoint countdown does not change when the reader loads the page
 * in the evening.
 */
export function daysSinceAnswered(page: WatchPage, date: string): number | null {
  const answered = lastAnsweredAt(page);
  if (!answered) return null;
  const days = daysUntil(answered, new Date(`${date}T00:00:00`));
  return days === null ? null : Math.max(0, -days);
}

/* ── The lines ──────────────────────────────────────────────────────────── */

/**
 * The two ways a case is named, and why they are not one way.
 *
 * Came back says "The {issue} on {page} is back", which wants the short name of
 * the problem — the thing, so it can take an article and a preposition. To
 * decide leads with the whole diagnosis, because that line is the first time the
 * reader meets the problem and a name is not an explanation. Putting the
 * diagnosis in the first slot produces "The The homepage ships a bundle nothing
 * on it uses. on Home is back.", which is how you can tell the slots are
 * different slots.
 */
function shortNameOf(issue: IssueCase): string {
  return issue.title || issue.diagnosis;
}

/** The case's own sentence, falling back to what the source called it. */
function diagnosisOf(issue: IssueCase): string {
  return issue.diagnosis || issue.title;
}

/**
 * The reading and the limit behind a threshold claim, or null when there is no
 * reading to make one from.
 *
 * Both strings come from `impact-format`, which owns how a saving is written —
 * including "Not measured". This asks it whether the reading was measured rather
 * than comparing the raw milliseconds itself, so there is one answer to "is
 * there a reading here" and the digest is not a second place that decides.
 *
 * Withheld in two cases, both rule 18. With no measured saving there is nothing
 * to compare, and claiming the case crossed a limit would assert a measurement
 * nobody took. With the gate at 0 there is no limit the reader set, so there is
 * nothing to attribute to them.
 */
function thresholdOf(issue: IssueCase, thresholds: PerformanceThresholds) {
  const reading = formatImpact(issue.impactMs);
  if (!reading.measured || thresholds.minimumSavingsMs <= 0) return null;
  return { reading: reading.text, limit: formatImpact(thresholds.minimumSavingsMs).text };
}

export interface DigestLineContext {
  pageTitles: Record<string, string>;
  pagesById: Record<string, WatchPage>;
  thresholds: PerformanceThresholds;
  /** The cohort's day, for anything counted in days. */
  date: string;
  locale?: string;
}

/**
 * The sentence one section says about one case.
 *
 * The single writer of every per-case line in the digest. The message calls it
 * to compose a section, and the case's arrival banner calls it to repeat the
 * line the reader clicked — so the two cannot word it differently, and the URL
 * carries the section rather than the prose. A digest link that carried its own
 * text would be a copy of a sentence the app can already derive, and the copy
 * would outlive the derivation.
 *
 * Held returns null, and that is the whole of W1's ruling about it: Held is one
 * line with a count, never a list, so there is no per-case sentence to write and
 * no Held link that could land on a case.
 */
export function digestLineFor(
  kind: DigestSectionKind,
  issue: IssueCase,
  context: DigestLineContext,
): string | null {
  const pages = includedPages(issue);
  if (kind === "came_back") {
    const disagreed = disagreedCheckpointOf(issue);
    if (!disagreed) return null;
    return digestLineBack(
      shortNameOf(issue),
      pageScopeOf(pages, context.pageTitles),
      Number.parseInt(disagreed.interval, 10),
      thresholdOf(issue, context.thresholds),
    );
  }
  if (kind === "to_decide") {
    return digestLineDecide(diagnosisOf(issue), digestOpenSince(issue.detectedAt, context.locale));
  }
  if (kind === "could_not_measure") {
    // Named by the page that stopped answering, because that is what is wrong:
    // the fix is fine as far as anyone knows, and nothing has been able to look.
    const silent = pages
      .map((pageId) => context.pagesById[pageId])
      .find((page): page is WatchPage => Boolean(page && daysSinceAnswered(page, context.date) !== null));
    if (!silent) return null;
    return digestLineNoCheck(silent.title, daysSinceAnswered(silent, context.date)!);
  }
  return null;
}

/* ── Arrival ────────────────────────────────────────────────────────────── */

/**
 * The query a digest link carries, so the case can name where the reader came
 * from.
 *
 * Two values, both facts the case cannot derive on its own: which digest, and
 * which of its sections. Neither is the sentence — see `digestLineFor` — and
 * neither is a filter. They exist to be read once on arrival and dropped.
 */
export const DIGEST_DATE_PARAM = "digest";
export const DIGEST_LINE_PARAM = "line";

export function digestArrivalQuery(date: string, kind: DigestSectionKind): string {
  return `${DIGEST_DATE_PARAM}=${encodeURIComponent(date)}&${DIGEST_LINE_PARAM}=${kind}`;
}

export interface DigestArrival {
  date: string;
  kind: DigestSectionKind;
}

/** The arrival a URL describes, or null when it describes none. */
export function parseDigestArrival(
  read: (key: string) => string | null | undefined,
): DigestArrival | null {
  const date = read(DIGEST_DATE_PARAM);
  const kind = read(DIGEST_LINE_PARAM);
  if (!date || !kind) return null;
  if (!(DIGEST_SECTIONS as readonly string[]).includes(kind)) return null;
  return { date, kind: kind as DigestSectionKind };
}

/* ── Building it ────────────────────────────────────────────────────────── */

function caseLink(input: DigestInput, issue: IssueCase, kind: DigestSectionKind): string {
  return absoluteUrl(input.appUrl, `${casePath(issue.id)}?${digestArrivalQuery(input.date, kind)}`);
}

/**
 * How much of the site tonight actually saw.
 *
 * A page whose run failed produced no measurement, so it is not counted. That is
 * what makes the number worth printing: "7 pages measured" and "2 pages
 * measured" are different nights even when the body of the message is identical,
 * and the footer is the only place that says which one this was.
 */
function pagesMeasured(pages: readonly WatchPage[]): number {
  return pages.filter((page) => isPageActivelyMonitored(page) && page.runState !== "failed").length;
}

export function buildDigest(input: DigestInput): Digest {
  const pageTitles = Object.fromEntries(input.pages.map((page) => [page.id, page.title]));
  const pagesById = Object.fromEntries(input.pages.map((page) => [page.id, page]));
  const thresholds = normalizePerformanceThresholds(input.thresholds);
  const cadence = normalizeDigestCadence(input.cadence);
  const schedule = normalizeCollectionSchedule(input.schedule);
  const context: DigestLineContext = {
    pageTitles,
    pagesById,
    thresholds,
    date: input.date,
    ...(input.locale ? { locale: input.locale } : {}),
  };

  // The savings gate the reader set applies to what the digest writes about, on
  // the same grounds it applies to the list's fold: below it, they asked not to
  // hear. Rule 18 keeps an unmeasured case on the right side of that — it is not
  // a small saving, so it is not gated by one.
  const reportable = partitionByImpact(input.cases, thresholds.minimumSavingsMs).inline;

  const byKind = new Map<DigestSectionKind, IssueCase[]>();
  for (const issue of reportable) {
    const kind = digestSectionOf(issue);
    if (!kind) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), issue]);
  }

  const linesFor = (kind: DigestSectionKind): DigestLine[] => {
    const cases = byKind.get(kind) ?? [];
    // Held is one line with a count and a link, never a list. It links to the
    // Watch queue rather than to a case because it is not about one — the only
    // link in the digest that may be a queue, and the reason `caseId` exists.
    if (kind === "held") {
      if (cases.length === 0) return [];
      return [{
        text: digestLineHeld(cases.length),
        href: absoluteUrl(input.appUrl, `${DESTINATION_PATH.issues}?queue=watch`),
      }];
    }
    return cases.flatMap((issue) => {
      const text = digestLineFor(kind, issue, context);
      return text ? [{ text, href: caseLink(input, issue, kind), caseId: issue.id }] : [];
    });
  };

  const sections = DIGEST_SECTIONS
    .map((kind) => ({ kind, heading: DIGEST_SECTION_HEADING[kind], lines: linesFor(kind) }))
    .filter((section) => section.lines.length > 0);

  const cameBack = (byKind.get("came_back") ?? []).length;

  return {
    site: input.site,
    date: input.date,
    cadence,
    subject: digestSubject(input.site, cameBack),
    sections,
    footer: {
      text: digestFooter(
        pagesMeasured(input.pages),
        `${schedule.localTime} ${schedule.timeZone}`,
        cadence,
        input.site,
      ),
      href: absoluteUrl(input.appUrl, DESTINATION_PATH.settings),
    },
    cameBack,
  };
}
