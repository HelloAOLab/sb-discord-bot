import {
  ApplicationCommandOptionType,
  InteractionContextType,
  InteractionResponseType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import { UserFacingError } from "../../utils/errors.js";
import { seedBibleLinksEnabled, setSeedBibleLinksEnabled } from "../../storage/guild-settings.js";
import { hasPermission } from "../permissions.js";
import type { Command } from "./types.js";

// /setseedbiblelinks [state: on|off] lets a server admin choose how Seed Bible links appear in
// the whole server: as "Open →" buttons (on, the default) or written out as plain text (off).
// Everything else works the same either way. Without `state`, it shows the current setting.
// Replies are private: it's a settings change, not something the channel needs to see.

export const setSeedBibleLinks: Command = {
  data: {
    name: "setseedbiblelinks",
    description: "Show Seed Bible links as buttons (on) or plain text (off) in this server (needs Manage Server)",
    // Hidden from members without Manage Server, and only available in servers.
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    contexts: [InteractionContextType.Guild],
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "state",
        description: "on: buttons, off: plain-text links. Leave empty to see the current setting.",
        choices: [
          { name: "on", value: "on" },
          { name: "off", value: "off" },
        ],
      },
    ],
  },

  async execute(interaction) {
    const guildId = interaction.guild_id;
    if (guildId === undefined) {
      throw new UserFacingError("This setting is per server, so use this command in a server.");
    }
    // Server admins can let anyone see the command in Server Settings → Integrations, so the
    // permission is checked here too, as the issue requires Manage Server.
    if (!hasPermission(interaction, PermissionFlagsBits.ManageGuild)) {
      throw new UserFacingError("You need the **Manage Server** permission to change this setting.");
    }

    const option = interaction.data.options?.find((o) => o.name === "state");
    const state = option?.type === ApplicationCommandOptionType.String ? option.value : undefined;

    let content: string;
    if (state === "on" || state === "off") {
      await setSeedBibleLinksEnabled(guildId, state === "on");
      console.log(`[settings] Seed Bible links turned ${state} in guild ${guildId}`);
      content =
        state === "off"
          ? "✅ Seed Bible link buttons are now **off** for this server. Links will be posted as plain text instead."
          : "✅ Seed Bible link buttons are now **on** for this server.";
    } else {
      content = (await seedBibleLinksEnabled(guildId))
        ? "Seed Bible link buttons are **on** for this server. Use `/setseedbiblelinks state: off` to post plain-text links instead."
        : "Seed Bible link buttons are **off** for this server, so links are posted as plain text. Use `/setseedbiblelinks state: on` to show buttons.";
    }

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content, flags: MessageFlags.Ephemeral },
    };
  },
};
