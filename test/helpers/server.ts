import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "../../src/server/app.js";
import { signRequest } from "./keys.js";

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

/** Starts the real Express app on a random free port. Call `close()` in afterAll. */
export async function startTestServer(): Promise<TestServer> {
  const server: Server = await new Promise((resolve) => {
    const s = createServer().listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export interface PostOptions {
  /** Send an invalid signature (to test rejection). */
  badSignature?: boolean;
  /** Omit the signature headers entirely. */
  unsigned?: boolean;
  /** Send (and sign) this exact string instead of JSON.stringify(payload). */
  rawBody?: string;
}

/**
 * POSTs a payload to /interactions signed exactly as Discord would sign it.
 * Returns the status and parsed JSON body (or raw text if the body isn't JSON).
 */
export async function postInteraction(baseUrl: string, payload: unknown, options: PostOptions = {}) {
  const body = options.rawBody ?? JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!options.unsigned) {
    let signature = signRequest(timestamp, body);
    if (options.badSignature) signature = (signature[0] === "0" ? "1" : "0") + signature.slice(1);
    headers["X-Signature-Ed25519"] = signature;
    headers["X-Signature-Timestamp"] = timestamp;
  }

  const res = await fetch(`${baseUrl}/interactions`, { method: "POST", headers, body });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json as any, text };
}
