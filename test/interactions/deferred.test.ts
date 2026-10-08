import { describe, expect, it, vi } from "vitest";
import { InteractionResponseType, MessageFlags, RouteBases, Routes } from "discord-api-types/v10";
import { completeDeferredReply, deferReply, deferUpdate, runDeferredWork, sendFollowUp } from "../../src/interactions/deferred.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { chatInputInteraction } from "../helpers/interactions.js";
import { mockFetch } from "../helpers/bible-api.js";

const interaction = chatInputInteraction("open");
const webhook = RouteBases.api + Routes.webhook(interaction.application_id, interaction.token);
const original = RouteBases.api + Routes.webhookMessage(interaction.application_id, interaction.token, "@original");

describe("deferred replies", () => {
  it("answers with a deferred response and runs the work only when the router asks", async () => {
    const { discordCalls } = mockFetch();
    const work = vi.fn(async () => ({ content: "done" }));

    const response = deferReply(interaction, work);

    expect(response).toEqual({ type: InteractionResponseType.DeferredChannelMessageWithSource });
    expect(work).not.toHaveBeenCalled();

    await runDeferredWork(response);
    expect(work).toHaveBeenCalledOnce();
    expect(discordCalls).toHaveLength(1);
  });

  it("runs the work only once", async () => {
    mockFetch();
    const work = vi.fn(async () => ({ content: "done" }));
    const response = deferReply(interaction, work);

    await runDeferredWork(response);
    await runDeferredWork(response);

    expect(work).toHaveBeenCalledOnce();
  });

  it("does nothing for a response that wasn't deferred", () => {
    expect(runDeferredWork({ type: InteractionResponseType.Pong })).toBeUndefined();
  });

  it("edits the original reply with the work's message", async () => {
    const { discordCalls } = mockFetch();

    await completeDeferredReply(interaction, async () => ({ content: "Open John 3 in Seed Bible:" }));

    expect(discordCalls).toEqual([
      { url: original, method: "PATCH", body: { content: "Open John 3 in Seed Bible:" } },
    ]);
  });

  it("replaces the public 'thinking' message with a private error for a UserFacingError", async () => {
    const { discordCalls } = mockFetch();

    await completeDeferredReply(interaction, async () => {
      throw new UserFacingError("I couldn't find a book called \"Jhon\".");
    });

    expect(discordCalls).toEqual([
      { url: original, method: "DELETE", body: undefined },
      {
        url: webhook,
        method: "POST",
        body: { content: "I couldn't find a book called \"Jhon\".", flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } },
      },
    ]);
  });

  it("shows a generic private error and logs any other failure", async () => {
    const { discordCalls } = mockFetch();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await completeDeferredReply(interaction, async () => {
      throw new Error("API is down");
    });

    expect(discordCalls.at(-1)?.body).toMatchObject({ content: "Something went wrong. Please try again.", flags: MessageFlags.Ephemeral });
    expect(log).toHaveBeenCalled();
  });

  it("logs instead of throwing when Discord rejects the edit, without leaking the token", async () => {
    const { discordCalls } = mockFetch({ discordStatus: 500 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(completeDeferredReply(interaction, async () => ({ content: "hi" }))).resolves.toBeUndefined();

    expect(discordCalls).toHaveLength(1); // only "not found" is retried
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[1])).not.toContain(interaction.token);
  });

  // On Workers the edit can reach Discord before Discord has registered the deferred response.
  it("retries the edit once, after a pause, if Discord doesn't know the message yet", async () => {
    vi.useFakeTimers();
    try {
      const { discordCalls } = mockFetch({ discordStatus: 404 });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const done = completeDeferredReply(interaction, async () => ({ content: "hi" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(discordCalls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      await done;

      expect(discordCalls.map((c) => c.method)).toEqual(["PATCH", "PATCH"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("succeeds when the retried edit goes through", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(null, { status: ++attempts === 1 ? 404 : 204 }),
      );
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const done = completeDeferredReply(interaction, async () => ({ content: "hi" }));
      await vi.advanceTimersByTimeAsync(1000);
      await done;

      expect(attempts).toBe(2);
      expect(log).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("can make the 'thinking' message private", () => {
    expect(deferReply(interaction, async () => ({}), { ephemeral: true })).toEqual({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral },
    });
  });

  it("sends a public follow-up message unless asked for a private one", async () => {
    const { discordCalls } = mockFetch();
    await sendFollowUp(interaction, { content: "hi" });
    expect(discordCalls).toEqual([{ url: webhook, method: "POST", body: { content: "hi" } }]);
  });
});

describe("deferred updates (components)", () => {
  it("answers with a deferred update and edits the component's message afterwards", async () => {
    const { discordCalls } = mockFetch();
    const response = deferUpdate(interaction, async () => ({ content: "updated" }));

    expect(response).toEqual({ type: InteractionResponseType.DeferredMessageUpdate });
    await runDeferredWork(response);

    expect(discordCalls).toEqual([{ url: original, method: "PATCH", body: { content: "updated" } }]);
  });

  it("leaves the message alone and sends the error privately when the work fails", async () => {
    const { discordCalls } = mockFetch();
    await runDeferredWork(deferUpdate(interaction, async () => {
      throw new UserFacingError("Nope.");
    }));

    expect(discordCalls).toEqual([
      { url: webhook, method: "POST", body: { content: "Nope.", flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } } },
    ]);
  });
});
