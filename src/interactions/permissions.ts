import { PermissionFlagsBits, type APIInteraction } from "discord-api-types/v10";

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
