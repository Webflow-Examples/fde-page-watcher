// Minimal, hand-maintained ambient types for the Cloudflare bindings this app
// actually uses (D1 + R2) — only the methods cfStore.ts calls. Deliberately
// narrower than @cloudflare/workers-types' full ambient surface, which
// redeclares global Response/Body/fetch in ways that conflict with Next.js's
// own DOM lib types in this single-tsconfig project.

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { rows_written?: number; [key: string]: unknown };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface R2ObjectBody {
  json<T = unknown>(): Promise<T>;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<unknown>;
}

type Fetcher = unknown;
