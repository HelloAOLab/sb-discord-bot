import { describe, expect, it } from "vitest";
import { ApplicationCommandOptionType, InteractionResponseType } from "discord-api-types/v10";
import { echo } from "../../../src/interactions/commands/echo.js";
import { chatInputInteraction, opt } from "../../helpers/interactions.js";

describe("/echo", () => {
  it("defines a required string option named 'message'", () => {
    expect(echo.data.options).toContainEqual(
      expect.objectContaining({ name: "message", type: ApplicationCommandOptionType.String, required: true }),
    );
  });

  it("echoes the message back", async () => {
    const response = await echo.execute(chatInputInteraction("echo", [opt.string("message", "hello")]));

    expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(response).toMatchObject({ data: { content: "hello" } });
  });

  it("blocks @everyone and role pings in echoed text", async () => {
    const response = await echo.execute(chatInputInteraction("echo", [opt.string("message", "@everyone hi")]));

    expect(response).toMatchObject({ data: { allowed_mentions: { parse: [] } } });
  });
});
