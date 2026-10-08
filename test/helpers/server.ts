import { createApp } from "../../src/server/app.js";
import { database } from "../../src/storage/database.js";
import type { Env } from "../../src/utils/config.js";
import { signRequest, testPublicKeyHex } from "./keys.js";

// Calls the real Hono app the way Cloudflare does — app.fetch(request, env, ctx) — with no
// server or network involved.

const app = createApp();

/** The Worker's env in tests: the test signing key and the current test database. */
export function testEnv(): Env {
  return { DISCORD_PUBLIC_KEY: testPublicKeyHex, DB: database() };
}

/** A stand-in for Cloudflare's ExecutionContext that remembers what was passed to waitUntil(). */
function testExecutionContext() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
    passThroughOnException: () => {},
    props: {},
  };
}

/**
 * Sends a request to the app. `background` resolves once everything the app passed to
 * waitUntil() (e.g. a deferred reply's follow-up) has finished.
 */
export async function request(path: string, init: RequestInit = {}, env: Partial<Env> = testEnv()) {
  const ctx = testExecutionContext();
  const res = await app.request(path, init, env, ctx);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json as any, text, background: Promise.all(ctx.pending).then(() => {}) };
}

export interface PostOptions {
  /** Send an invalid signature (to test rejection). */
  badSignature?: boolean;
  /** Omit the signature headers entirely. */
  unsigned?: boolean;
  /** Send (and sign) this exact string instead of JSON.stringify(payload). */
  rawBody?: string;
  /** Override the Worker env (e.g. to test a missing secret). */
  env?: Partial<Env>;
}

/** POSTs a payload to /interactions signed exactly as Discord would sign it. */
export async function postInteraction(payload: unknown, options: PostOptions = {}) {
  const body = options.rawBody ?? JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!options.unsigned) {
    let signature = signRequest(timestamp, body);
    if (options.badSignature) signature = (signature[0] === "0" ? "1" : "0") + signature.slice(1);
    headers["X-Signature-Ed25519"] = signature;
    headers["X-Signature-Timestamp"] = timestamp;
  }

  return request("/interactions", { method: "POST", headers, body }, options.env);
}
