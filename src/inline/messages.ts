import {
  MessageType,
  RouteBases,
  Routes,
  type GatewayMessageCreateDispatchData,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { findPassages } from "../bible/references.js";
import { inlineReplySettings } from "../storage/guild-settings.js";
import { passageReplies } from "./passages.js";

// Inline verses: when someone writes a Bible reference in a server that turned them on
// (/setinlineverses), the bot replies with the passage, without a slash command.
// The Gateway connection (gateway/) receives every new message and passes it here.

/**
 * Replies to the Bible references in `message`, if it has any and its server has inline verses on:
 * one reply per passage ("gen 1 1 and exo 2 3" gets two). Returns whether any reply was posted.
 * A reply Discord rejects (e.g. the bot can't post in that channel) is logged and skipped.
 */
export async function replyToReferences(message: GatewayMessageCreateDispatchData, token: string): Promise<boolean> {
  // Only people's ordinary messages and replies in servers; never bots (including this one), so
  // two bots can't answer each other forever.
  if (message.author.bot || message.webhook_id !== undefined || message.guild_id === undefined) return false;
  if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return false;

  // Most messages have no reference, so check the text before touching the database.
  const passages = findPassages(message.content);
  if (passages.length === 0) return false;
  const settings = await inlineReplySettings(message.guild_id);
  if (!settings.inlineVerses) return false;

  let replied = false;
  for (const reply of await passageReplies(passages, { buttons: settings.seedBibleLinks })) {
    try {
      await createMessage(token, message.channel_id, {
        ...reply,
        // Shown as a reply to the message, without pinging its author.
        message_reference: { message_id: message.id, fail_if_not_exists: false },
        allowed_mentions: { parse: [], replied_user: false },
      });
      replied = true;
    } catch (error) {
      console.error(`[inline] Couldn't reply to message ${message.id}:`, error);
    }
  }
  return replied;
}

/** Posts a message as the bot. Unlike interaction replies, this needs the bot token. */
async function createMessage(token: string, channelId: string, body: RESTPostAPIChannelMessageJSONBody): Promise<void> {
  const response = await fetch(`${RouteBases.api}${Routes.channelMessages(channelId)}`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Discord POST /channels/${channelId}/messages failed: ${response.status} ${await response.text()}`);
  }
}
