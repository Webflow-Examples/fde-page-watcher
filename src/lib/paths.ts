export function normalizeBasePath(value: string | undefined): string {
  let trimmed = value?.trim();
  if (!trimmed || trimmed === "/") return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      trimmed = new URL(trimmed).pathname;
    } catch {
      return "";
    }
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function withBasePath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBasePath(basePath)}${normalizedPath}` || "/";
}
