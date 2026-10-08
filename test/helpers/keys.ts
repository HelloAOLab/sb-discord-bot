import { generateKeyPairSync, sign } from "node:crypto";

// A throwaway Ed25519 key pair standing in for Discord's. The app is given the public key
// (as DISCORD_PUBLIC_KEY in testEnv(), test/helpers/server.ts); tests sign requests with the private key.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

/** Raw 32-byte public key as hex — the same format the Developer Portal shows. */
export const testPublicKeyHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

/** Signs a request the way Discord does: Ed25519 over `timestamp + rawBody`. */
export function signRequest(timestamp: string, rawBody: string): string {
  return sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
}
