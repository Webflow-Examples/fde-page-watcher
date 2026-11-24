import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error -- node:sqlite is newer than the @types/node version in this repo.
import { DatabaseSync } from "node:sqlite";

/**
 * A real SQLite database behind the narrow D1 surface this app uses.
 *
 * The parity test is worth little if both sides are hand-written fakes that
 * happen to agree, so this runs the actual migration and the actual parameter
 * binding against SQLite. Only `prepare/bind/first/all/run` are mapped, which is
 * all `cfStore` relies on too.
 */
export function createSqliteD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const migration = readFileSync(
    path.resolve(process.cwd(), "migrations/0008_task_integrations.sql"),
    "utf8",
  );
  db.exec(migration);

  const database = db as unknown as {
    prepare(query: string): {
      get(...values: unknown[]): unknown;
      all(...values: unknown[]): unknown[];
      run(...values: unknown[]): { changes?: number | bigint };
    };
  };

  const prepare = (query: string) => {
    let values: unknown[] = [];
    const statement = {
      bind(...next: unknown[]) {
        values = next;
        return statement;
      },
      async first<T = unknown>(): Promise<T | null> {
        return (database.prepare(query).get(...values) ?? null) as T | null;
      },
      async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
        return { results: database.prepare(query).all(...values) as T[], success: true, meta: {} };
      },
      async run<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
        const result = database.prepare(query).run(...values);
        return { results: [], success: true, meta: { rows_written: Number(result.changes ?? 0) } };
      },
    };
    return statement;
  };

  return { prepare } as unknown as D1Database;
}
