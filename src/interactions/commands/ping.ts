import { InteractionResponseType } from "discord-api-types/v10";
import { pingAgainRow } from "../components/ping-again.js";
import type { Command } from "./types.js";

export const ping: Command = {
  data: {
    name: "ping",
    description: "Replies with Pong",
  },

  execute() {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: "Pong!", components: [pingAgainRow(1)] },
    };
  },
};
