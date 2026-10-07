import {
  ButtonStyle,
  ComponentType,
  InteractionResponseType,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from "discord-api-types/v10";
import { customId } from "./custom-id.js";
import type { Component } from "./types.js";

const ID = "ping-again";

/** The "Ping again" button row, carrying how many pongs have been sent so far. */
export function pingAgainRow(count: number): APIActionRowComponent<APIComponentInMessageActionRow> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "Ping again",
        custom_id: customId(ID, count),
      },
    ],
  };
}

export const pingAgain: Component = {
  id: ID,

  execute(_interaction, [countArg]) {
    const previous = Number.parseInt(countArg ?? "", 10);
    const count = (Number.isFinite(previous) && previous > 0 ? previous : 1) + 1;

    // UpdateMessage edits the message the button is on instead of posting a new one.
    return {
      type: InteractionResponseType.UpdateMessage,
      data: { content: `Pong! ×${count}`, components: [pingAgainRow(count)] },
    };
  },
};
