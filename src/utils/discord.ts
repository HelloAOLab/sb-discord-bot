import { RouteBases, Routes, type RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";

/**
 * Posts a message as the bot (inline verses, session reminders). Unlike interaction replies, this
 * needs the bot token, and the bot must be in the server with permission to post in the channel.
 * Throws if Discord rejects it.
 */
export async function createMessage(token: string, channelId: string, body: RESTPostAPIChannelMessageJSONBody): Promise<void> {
  const response = await fetch(`${RouteBases.api}${Routes.channelMessages(channelId)}`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Discord POST /channels/${channelId}/messages failed: ${response.status} ${await response.text()}`);
  }
}
