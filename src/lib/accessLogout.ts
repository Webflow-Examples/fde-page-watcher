interface AccessLogoutConfig {
  brokerUrl?: string;
  teamDomain?: string;
}

function secureOrigin(value: string | undefined, requiredSuffix?: string): URL | null {
  const input = value?.trim();
  if (!input) return null;
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    if (requiredSuffix && !url.hostname.endsWith(requiredSuffix)) return null;
    return url;
  } catch {
    return null;
  }
}

export function accessLogoutUrls(config: AccessLogoutConfig): string[] {
  const application = secureOrigin(config.brokerUrl);
  const team = secureOrigin(config.teamDomain, ".cloudflareaccess.com");
  return [...new Set([application, team]
    .filter((url): url is URL => Boolean(url))
    .map((url) => new URL("/cdn-cgi/access/logout", url).toString()))];
}
