import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandInteractionDataStringOption,
} from "discord-api-types/v10";
import type { Command } from "./types.js";

export const echo: Command = {
  data: {
    name: "echo",
    description: "Echoes back your message",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "message",
        description: "What to echo",
        required: true,
      },
    ],
  },

  execute(interaction) {
    const option = interaction.data.options?.find(
      (o): o is APIApplicationCommandInteractionDataStringOption => o.name === "message",
    );

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: option?.value ?? "", allowed_mentions: { parse: [] } },
    };
  },
};
