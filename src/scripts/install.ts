import { ApplicationIntegrationType, OAuth2Scopes, PermissionFlagsBits, type APIApplication } from "discord-api-types/v10";

// What the bot asks for when it's added to a server: the Developer Portal's Installation page →
// Default Install Settings → Guild Install. `pnpm dev:bot` applies these to the dev bot.

/**
 * The scopes: `bot` puts the bot user in the server (inline verses and session reminders post as
 * it), and `applications.commands` adds the slash commands.
 */
export const INSTALL_SCOPES = [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands];

/** Every permission the bot uses, and why. Interaction replies need none of them. */
export const BOT_PERMISSIONS = {
  /** See the channels it posts in. */
  ViewChannel: PermissionFlagsBits.ViewChannel,
  /** Inline-verse replies, and reading sessions' reminders and start messages. */
  SendMessages: PermissionFlagsBits.SendMessages,
  /** The same, when they happen in a thread. */
  SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
  /** Inline verses reply to the message with the reference, which Discord only allows with this. */
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
};

export const botPermissions = (): bigint => Object.values(BOT_PERMISSIONS).reduce((all, bit) => all | bit, 0n);

/**
 * The application's install settings with the guild install set to INSTALL_SCOPES and
 * BOT_PERMISSIONS. Any other install type (installing to a user's account) is kept as it is.
 */
export function guildInstallConfig(app: Pick<APIApplication, "integration_types_config">): NonNullable<APIApplication["integration_types_config"]> {
  return {
    ...app.integration_types_config,
    [ApplicationIntegrationType.GuildInstall]: {
      oauth2_install_params: { scopes: INSTALL_SCOPES, permissions: botPermissions().toString() },
    },
  };
}

/**
 * A link that adds the bot to a server with these settings. With `guildId`, Discord picks that
 * server. Opening it again for a server the bot is already in updates its permissions there, which
 * changing the install settings alone doesn't do.
 */
export function inviteUrl(clientId: string, guildId?: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", INSTALL_SCOPES.join(" "));
  url.searchParams.set("permissions", botPermissions().toString());
  url.searchParams.set("integration_type", String(ApplicationIntegrationType.GuildInstall));
  if (guildId) {
    url.searchParams.set("guild_id", guildId);
    url.searchParams.set("disable_guild_select", "true");
  }
  return url.toString();
}
