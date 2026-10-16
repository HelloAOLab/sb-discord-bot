import { RouteBases, Routes, type APIApplication, type RESTPatchCurrentApplicationJSONBody } from "discord-api-types/v10";
import { commandList } from "../interactions/commands/index.js";

// Discord REST calls the scripts make as the bot (they run on your machine with Node, not on
// Cloudflare): registering slash commands and changing the application's settings.

/** Calls Discord's REST API with the bot token. Throws with Discord's message if it fails. */
export async function discordApi<T>(token: string, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(RouteBases.api + route, {
    method,
    headers: { Authorization: `Bot ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Discord ${method} ${route} failed (${response.status}): ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Registers every command in `commandList`, replacing the application's current ones. With
 * `guildId`, they're registered in that server only and appear at once; otherwise globally, which
 * can take up to an hour to show up. Returns how many were registered.
 */
export async function registerCommands(token: string, clientId: string, guildId?: string): Promise<number> {
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  const body = commandList.map((command) => command.data);
  await discordApi(token, "PUT", route, body);
  return body.length;
}

/** The application the bot token belongs to. */
export function currentApplication(token: string): Promise<APIApplication> {
  return discordApi<APIApplication>(token, "GET", Routes.currentApplication());
}

/** Changes the application's install settings (Developer Portal → Installation). */
export async function setInstallSettings(token: string, config: NonNullable<APIApplication["integration_types_config"]>): Promise<void> {
  const body: RESTPatchCurrentApplicationJSONBody = { integration_types_config: config };
  await discordApi(token, "PATCH", Routes.currentApplication(), body);
}

/**
 * Sets the application's Interactions Endpoint URL. Discord first sends the URL a signed PING, and
 * refuses (400) if it doesn't answer with PONG, so the Worker must already be reachable there.
 */
export async function setInteractionsEndpoint(token: string, url: string): Promise<void> {
  const body: RESTPatchCurrentApplicationJSONBody = { interactions_endpoint_url: url };
  await discordApi(token, "PATCH", Routes.currentApplication(), body);
}
