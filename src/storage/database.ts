// The app's only persistent storage: a Cloudflare D1 database (SQLite), bound to the Worker as
// `DB` in wrangler.jsonc. Its tables are created by the SQL files in migrations/.
//
// Only the small part of D1's API we use is described here, so code doesn't depend on
// Cloudflare's type package and tests can supply an in-memory stand-in (test/helpers/database.ts).

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  /** The first row, or null if there are none. */
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
}

let current: SqlDatabase | undefined;

/**
 * Sets the database for this Worker instance. The Worker calls it at the start of each request
 * with its D1 binding (the same object for every request), so the rest of the code can just
 * call database().
 */
export function useDatabase(db: SqlDatabase): void {
  current = db;
}

export function database(): SqlDatabase {
  if (!current) throw new Error("No database: useDatabase() must be called first.");
  return current;
}
