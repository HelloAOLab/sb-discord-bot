// How the Worker reaches the Gateway Durable Object (durable-object.ts). There's exactly one,
// named "main", for the bot's one connection.

/** The parts of Cloudflare's DurableObjectNamespace used here. */
export interface GatewayNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

const OBJECT_NAME = "main";

let current: GatewayNamespace | undefined;

/** Sets the GATEWAY binding for this Worker instance (like useDatabase()). Undefined in tests. */
export function useGateway(namespace: GatewayNamespace | undefined): void {
  current = namespace;
}

/**
 * Asks the Gateway object to check right away whether it should be connected, so turning inline
 * verses on or off in a server takes effect now rather than at the next check. Does nothing when
 * there's no GATEWAY binding (tests).
 */
export async function wakeGateway(): Promise<void> {
  if (!current) return;
  const response = await current.get(current.idFromName(OBJECT_NAME)).fetch("https://gateway/wake", { method: "POST" });
  if (!response.ok) throw new Error(`Gateway wake failed: ${response.status}`);
}
