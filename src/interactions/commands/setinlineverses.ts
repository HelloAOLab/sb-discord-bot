import {
  ApplicationCommandOptionType,
  InteractionContextType,
  InteractionResponseType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import { wakeGateway } from "../../gateway/control.js";
import { UserFacingError } from "../../utils/errors.js";
import { inlineVersesEnabled, setInlineVersesEnabled } from "../../storage/guild-settings.js";
import { hasPermission } from "../permissions.js";
import type { Command } from "./types.js";

// /setinlineverses [state: on|off] lets a server admin choose whether the bot replies to Bible
// references in this server's messages ("John 3:16" → the verse), without a slash command.
// Off by default. Without `state`, it shows the current setting. Replies are private.
// The bot's Gateway connection (src/gateway/) only runs while at least one server has this on, so
// changing it also wakes the connection to start or stop right away.

export const setInlineVerses: Command = {
  data: {
    name: "setinlineverses",
    description: "Reply to Bible references like John 3:16 in this server's messages (needs Manage Server)",
    // Hidden from members without Manage Server, and only available in servers.
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    contexts: [InteractionContextType.Guild],
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "state",
        description: "on: reply to references, off: don't. Leave empty to see the current setting.",
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
    // Server admins can let anyone see the command in Server Settings → Integrations.
    if (!hasPermission(interaction, PermissionFlagsBits.ManageGuild)) {
      throw new UserFacingError("You need the **Manage Server** permission to change this setting.");
    }

    const option = interaction.data.options?.find((o) => o.name === "state");
    const state = option?.type === ApplicationCommandOptionType.String ? option.value : undefined;

    let content: string;
    if (state === "on" || state === "off") {
      await setInlineVersesEnabled(guildId, state === "on");
      console.log(`[settings] Inline verses turned ${state} in guild ${guildId}`);
      try {
        await wakeGateway();
      } catch (error) {
        // The setting is saved; the connection catches up at its next check (within 5 minutes).
        console.error("[settings] Couldn't wake the Gateway connection:", error);
      }
      content =
        state === "on"
          ? "✅ Inline verses are now **on** for this server. When someone writes a reference like John 3:16, I'll reply with the passage."
          : "✅ Inline verses are now **off** for this server. I'll no longer reply to references in messages.";
    } else {
      content = (await inlineVersesEnabled(guildId))
        ? "Inline verses are **on** for this server: I reply to references like John 3:16. Use `/setinlineverses state: off` to stop."
        : "Inline verses are **off** for this server. Use `/setinlineverses state: on` to have me reply to references like John 3:16.";
    }

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content, flags: MessageFlags.Ephemeral },
    };
  },
};
