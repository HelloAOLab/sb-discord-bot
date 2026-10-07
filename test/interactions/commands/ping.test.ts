import { describe, expect, it } from "vitest";
import { InteractionResponseType } from "discord-api-types/v10";
import { ping } from "../../../src/interactions/commands/ping.js";
import { pingAgainRow } from "../../../src/interactions/components/ping-again.js";
import { chatInputInteraction } from "../../helpers/interactions.js";

describe("/ping", () => {
  it("has a valid command definition", () => {
    expect(ping.data.name).toBe("ping");
    expect(ping.data.description).toBeTruthy();
  });

  it("replies with Pong and a 'Ping again' button", async () => {
    const response = await ping.execute(chatInputInteraction("ping"));

    expect(response).toEqual({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: "Pong!", components: [pingAgainRow(1)] },
    });
  });
});
