import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement } from "../../src/storage/database.js";

// A stand-in for the Worker's D1 database: an in-memory SQLite database (Node's built-in driver)
// behind the same small API the app uses (prepare → bind → first / all / run). D1 is SQLite too,
// so the same SQL runs on both. It's set up with the real files in migrations/, so tests also
// catch a broken migration.

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

export function createTestDatabase(): SqlDatabase & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS_DIR), "utf8"));
  }

  const statement = (query: string, params: unknown[]): SqlStatement => ({
    bind: (...values) => statement(query, values),
    first: async <T>() => (sqlite.prepare(query).get(...(params as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: sqlite.prepare(query).all(...(params as never[])) as T[] }),
    run: async () => sqlite.prepare(query).run(...(params as never[])),
  });

  return { sqlite, prepare: (query) => statement(query, []) };
}
