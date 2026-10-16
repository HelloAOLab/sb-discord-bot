import { ChannelType, PermissionFlagsBits, type APIInteraction } from "discord-api-types/v10";

/**
 * Whether the user who triggered the interaction has `permission` in the server (Administrator
 * counts as every permission). Discord sends the user's permissions with each interaction in a
 * server, already adjusted for the channel. Always false outside servers.
 *
 * A command's `default_member_permissions` only hides it by default, and server admins can
 * override that, so commands that must be restricted also check here.
 */
export function hasPermission(interaction: Pick<APIInteraction, "member">, permission: bigint): boolean {
  const raw = interaction.member?.permissions;
  if (!raw) return false;
  const granted = BigInt(raw);
  return (granted & PermissionFlagsBits.Administrator) !== 0n || (granted & permission) === permission;
}

const THREAD_TYPES = new Set<number>([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);

/**
 * Whether the bot can post in the channel the interaction came from, from the app permissions
 * Discord sends with it. Replies to interactions don't need this, but messages the bot posts by
 * itself later (session reminders) do. False when the app was added without its bot.
 */
export function appCanPost(interaction: Pick<APIInteraction, "app_permissions" | "channel">): boolean {
  const granted = BigInt(interaction.app_permissions || "0");
  const send = interaction.channel && THREAD_TYPES.has(interaction.channel.type)
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
  const needed = PermissionFlagsBits.ViewChannel | send;
  return (granted & PermissionFlagsBits.Administrator) !== 0n || (granted & needed) === needed;
}
