const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_BYTES = 128 * 1024;
const DEFAULT_MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 8_000;

export type PageTitleErrorCode =
  | "invalid_url"
  | "blocked_url"
  | "fetch_failed"
  | "timed_out"
  | "unsupported_content"
  | "title_not_found";

export class PageTitleError extends Error {
  constructor(
    public readonly code: PageTitleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PageTitleError";
  }
}

type ResolveHost = (hostname: string) => Promise<string[] | null>;

interface DiscoverPageTitleOptions {
  fetchFn?: typeof fetch;
  resolveHost?: ResolveHost;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

export interface DiscoveredPageTitle {
  title: string;
  url: string;
}

function normalizeUrl(value: string): URL {
  const trimmed = value.trim();
  if (!trimmed) throw new PageTitleError("invalid_url", "Enter a URL");
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new PageTitleError("invalid_url", "Enter a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageTitleError("invalid_url", "Only HTTP and HTTPS URLs can be scanned");
  }
  if (url.username || url.password) {
    throw new PageTitleError("blocked_url", "URLs containing credentials cannot be scanned");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new PageTitleError("blocked_url", "Only standard web ports can be scanned");
  }
  return url;
}

function ipv4Octets(value: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const octets = value.split(".").map(Number);
  return octets.every((part) => part >= 0 && part <= 255) ? octets : null;
}

function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = ipv4Octets(normalized);
  if (ipv4) {
    const [a, b, c] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (!normalized.includes(":")) return false;
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function isIpLiteral(hostname: string): boolean {
  return ipv4Octets(hostname) !== null || hostname.includes(":");
}

async function defaultResolveHost(hostname: string): Promise<string[] | null> {
  try {
    const { lookup } = await import("node:dns/promises");
    const results = await lookup(hostname, { all: true, verbatim: true });
    return results.map((result) => result.address);
  } catch (error) {
    // Cloudflare's Node compatibility layer may expose node:dns without an
    // implementation. Worker fetch still prevents direct private-IP egress,
    // while literal and redirect targets remain checked here.
    if (/not implemented|unsupported|ENOSYS/i.test(String(error))) return null;
    throw new PageTitleError("fetch_failed", "The page address could not be resolved");
  }
}

async function assertSafeTarget(url: URL, resolveHost: ResolveHost): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    isBlockedAddress(hostname)
  ) {
    throw new PageTitleError("blocked_url", "Private and local URLs cannot be scanned");
  }
  if (isIpLiteral(hostname)) return;

  const addresses = await resolveHost(hostname);
  if (addresses === null) return;
  if (addresses.length === 0) {
    throw new PageTitleError("fetch_failed", "The page address could not be resolved");
  }
  if (addresses.some(isBlockedAddress)) {
    throw new PageTitleError("blocked_url", "Private and local URLs cannot be scanned");
  }
}

async function readLimitedHtml(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      total += chunk.byteLength;
      html += decoder.decode(chunk, { stream: true });
      if (/<\/title\s*>/i.test(html) || /<\/head\s*>/i.test(html)) break;
    }
    html += decoder.decode();
    return html;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "©",
  gt: ">",
  hellip: "…",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  reg: "®",
  trade: "™",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] === "#") {
      const hex = key[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return entity;
    }
    return ENTITIES[key.toLowerCase()] ?? entity;
  });
}

export function extractPageTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return null;
  const title = decodeHtmlEntities(match[1])
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title ? title.slice(0, 240) : null;
}

export async function discoverPageTitle(
  value: string,
  options: DiscoverPageTitleOptions = {},
): Promise<DiscoveredPageTitle> {
  const fetchFn = options.fetchFn ?? fetch;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = normalizeUrl(value);

  try {
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      await assertSafeTarget(url, resolveHost);
      let response: Response;
      try {
        response = await fetchFn(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "Page Watcher title lookup/1.0",
          },
        });
      } catch {
        if (controller.signal.aborted) {
          throw new PageTitleError("timed_out", "The page title lookup timed out");
        }
        throw new PageTitleError("fetch_failed", "The page could not be reached");
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new PageTitleError("fetch_failed", "The page returned an invalid redirect");
        if (redirect === maxRedirects) {
          throw new PageTitleError("fetch_failed", "The page redirected too many times");
        }
        url = normalizeUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new PageTitleError("fetch_failed", `The page returned HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        await response.body?.cancel().catch(() => undefined);
        throw new PageTitleError("unsupported_content", "The URL did not return an HTML page");
      }
      const title = extractPageTitle(await readLimitedHtml(response, maxBytes));
      if (!title) throw new PageTitleError("title_not_found", "No page title was found");
      return { title, url: url.toString() };
    }
    throw new PageTitleError("fetch_failed", "The page redirected too many times");
  } finally {
    clearTimeout(timer);
  }
}
