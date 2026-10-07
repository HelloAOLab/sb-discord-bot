import { describe, expect, it } from "vitest";
import { ButtonStyle, ComponentType, InteractionResponseType } from "discord-api-types/v10";
import { pingAgain, pingAgainRow } from "../../../src/interactions/components/ping-again.js";
import { components } from "../../../src/interactions/components/index.js";
import { customId } from "../../../src/interactions/components/custom-id.js";
import { buttonInteraction } from "../../helpers/interactions.js";

const click = (count?: string) =>
  pingAgain.execute(buttonInteraction(customId("ping-again", count ?? "")), count === undefined ? [] : [count]);

describe("ping-again button", () => {
  it("is registered under the id its custom_id starts with", () => {
    expect(components.get("ping-again")).toBe(pingAgain);
    expect(pingAgainRow(1).components[0]).toMatchObject({ custom_id: "ping-again:1" });
  });

  it("renders a secondary button labelled 'Ping again'", () => {
    expect(pingAgainRow(1)).toEqual({
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Ping again", custom_id: "ping-again:1" }],
    });
  });

  it("updates the same message with the next count and a fresh button", async () => {
    const response = await click("1");

    expect(response).toEqual({
      type: InteractionResponseType.UpdateMessage,
      data: { content: "Pong! ×2", components: [pingAgainRow(2)] },
    });
  });

  it("keeps counting from the count in the custom_id", async () => {
    expect(await click("41")).toMatchObject({ data: { content: "Pong! ×42" } });
  });

  it("treats a missing or garbled count as the first pong", async () => {
    expect(await click()).toMatchObject({ data: { content: "Pong! ×2" } });
    expect(await click("abc")).toMatchObject({ data: { content: "Pong! ×2" } });
    expect(await click("-5")).toMatchObject({ data: { content: "Pong! ×2" } });
  });
});
