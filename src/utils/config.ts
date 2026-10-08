import { z } from "zod";
import type { SqlDatabase } from "../storage/database.js";

// What the Worker receives from Cloudflare with every request: variables and secrets
// (`wrangler secret put`, or .env when running `wrangler dev`) and bindings such as the D1 database
// (wrangler.jsonc). Read them through parseEnv(), never through process.env.
// The command-registration script (scripts/deploy-commands.ts) runs in Node and reads .env instead.

export interface Env {
  /** Discord Developer Portal → General Information → Public Key. Used to verify requests. */
  DISCORD_PUBLIC_KEY: string;
  /** The D1 database (binding "DB" in wrangler.jsonc). */
  DB: SqlDatabase;
}

const envSchema = z.object({
  DISCORD_PUBLIC_KEY: z
    .string({ error: "DISCORD_PUBLIC_KEY is missing. Set it with `wrangler secret put DISCORD_PUBLIC_KEY`." })
    .regex(/^[0-9a-f]{64}$/i, "DISCORD_PUBLIC_KEY must be the 64-character hex Public Key from the Developer Portal."),
  DB: z.custom<SqlDatabase>(
    (value) => typeof (value as SqlDatabase | undefined)?.prepare === "function",
    "DB is missing. Check the d1_databases binding in wrangler.jsonc.",
  ),
});

const checked = new WeakSet<object>();

/**
 * Checks the Worker's environment and returns it typed. Throws an Error listing every problem.
 * Cloudflare passes the same env object to every request, so it's only checked once.
 */
export function parseEnv(env: unknown): Env {
  if (typeof env === "object" && env !== null && checked.has(env)) return env as Env;

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid Worker environment:\n${parsed.error.issues.map((i) => `  - ${i.message}`).join("\n")}`);
  }
  checked.add(env as object);
  return env as Env;
}
