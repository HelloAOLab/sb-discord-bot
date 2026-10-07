import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InteractionResponseType, InteractionType, MessageFlags, PermissionFlagsBits } from "discord-api-types/v10";
import { commands } from "../../src/interactions/commands/index.js";
import { components } from "../../src/interactions/components/index.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { mockFetch } from "../helpers/bible-api.js";
import {
  autocompleteInteraction,
  buttonInteraction,
  chatInputInteraction,
  opt,
  selectInteraction,
  withPermissions,
} from "../helpers/interactions.js";
import { postInteraction, startTestServer, type TestServer } from "../helpers/server.js";

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

describe("POST /interactions", () => {
  describe("signature verification", () => {
    it("answers Discord's PING with PONG", async () => {
      const res = await postInteraction(server.url, { type: InteractionType.Ping });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: InteractionResponseType.Pong });
    });

    it("rejects a request with an invalid signature", async () => {
      const res = await postInteraction(server.url, { type: InteractionType.Ping }, { badSignature: true });
      expect(res.status).toBe(401);
    });

    // Guards the middleware order in server/app.ts: if express.json() runs first, the middleware
    // re-serializes the parsed body, the bytes no longer match what was signed, and this fails.
    it("verifies against the raw body bytes, not re-serialized JSON", async () => {
      const payload = chatInputInteraction("ping");
      const res = await postInteraction(server.url, payload, { rawBody: JSON.stringify(payload, null, 2) });

      expect(res.status).toBe(200);
    });

    it("rejects an unsigned request", async () => {
      const res = await postInteraction(server.url, { type: InteractionType.Ping }, { unsigned: true });
      expect(res.status).toBe(401);
    });
  });

  describe("command routing", () => {
    it("routes a slash command to its handler", async () => {
      const res = await postInteraction(server.url, chatInputInteraction("ping"));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: "Pong!" },
      });
    });

    it("replies privately for an unknown command", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await postInteraction(server.url, chatInputInteraction("does-not-exist"));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
    });

    it("replies privately when a command throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(commands.get("ping")!, "execute").mockRejectedValueOnce(new Error("boom"));

      const res = await postInteraction(server.url, chatInputInteraction("ping"));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
      expect(res.body.data.content).toMatch(/went wrong/);
    });

    it("shows a UserFacingError's own message privately, without logging it", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(commands.get("ping")!, "execute").mockRejectedValueOnce(new UserFacingError("Try \"John 3\"."));

      const res = await postInteraction(server.url, chatInputInteraction("ping"));

      expect(res.body).toEqual({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: 'Try "John 3".', flags: MessageFlags.Ephemeral },
      });
      expect(log).not.toHaveBeenCalled();
    });

    it("sends a deferred response first, then edits it via Discord's webhook", async () => {
      const { discordCalls } = mockFetch({ passThrough: server.url });

      const res = await postInteraction(server.url, chatInputInteraction("open"));

      expect(res.body).toEqual({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: MessageFlags.Ephemeral },
      });
      await vi.waitFor(() => expect(discordCalls).toHaveLength(1));
      expect(discordCalls[0]).toMatchObject({ method: "PATCH", body: { content: expect.stringMatching(/^Choose a book\./) } });
    });

    it("remembers a server's Seed Bible links setting between requests", async () => {
      const setting = (state: string) =>
        withPermissions(chatInputInteraction("setseedbiblelinks", [opt.string("state", state)]), PermissionFlagsBits.ManageGuild);
      /** Picks John 3 in the picker and returns the public message it posts. */
      async function pickJohn3() {
        const { discordCalls } = mockFetch({ passThrough: server.url });
        await postInteraction(server.url, selectInteraction("open-picker:chapter:::JHN:0:0", ["3"]));
        await vi.waitFor(() => expect(discordCalls.some((c) => c.method === "POST")).toBe(true));
        vi.restoreAllMocks();
        return discordCalls.find((c) => c.method === "POST")!.body;
      }

      expect((await postInteraction(server.url, setting("off"))).body.data.content).toMatch(/now \*\*off\*\*/);
      expect(await pickJohn3()).toEqual({
        content: "Open John 3 in Seed Bible: <https://seedbible.org/?book=JHN&chapter=3&source=discord_bot>",
        allowed_mentions: { parse: [] },
      });

      await postInteraction(server.url, setting("on"));
      expect((await pickJohn3()).components[0].components[0]).toMatchObject({ label: "Open →" });
    });

    it("rejects interaction types it doesn't handle", async () => {
      const res = await postInteraction(server.url, { ...chatInputInteraction("ping"), type: InteractionType.ModalSubmit });
      expect(res.status).toBe(400);
    });
  });

  describe("component routing", () => {
    it("routes a button click to the component named at the start of its custom_id", async () => {
      const res = await postInteraction(server.url, buttonInteraction("ping-again:4"));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        type: InteractionResponseType.UpdateMessage,
        data: { content: "Pong! ×5" },
      });
    });

    it("routes a select menu choice and runs its deferred work after responding", async () => {
      const { discordCalls } = mockFetch({ passThrough: server.url });

      const res = await postInteraction(server.url, selectInteraction("open-picker:book::::0:0", ["JHN"]));

      expect(res.body).toEqual({ type: InteractionResponseType.DeferredMessageUpdate });
      await vi.waitFor(() => expect(discordCalls).toHaveLength(1));
      expect(discordCalls[0]).toMatchObject({ method: "PATCH", body: { content: "Choose a chapter of **John**." } });
    });

    it("replies privately for an unknown component", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await postInteraction(server.url, buttonInteraction("removed-button:1"));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
      expect(res.body.data.content).toMatch(/no longer works/);
    });

    it("replies privately when a component throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(components.get("ping-again")!, "execute").mockRejectedValueOnce(new Error("boom"));

      const res = await postInteraction(server.url, buttonInteraction("ping-again:1"));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
      expect(res.body.data.content).toMatch(/went wrong/);
    });
  });

  describe("autocomplete routing", () => {
    it("returns the command's suggestions", async () => {
      const res = await postInteraction(server.url, autocompleteInteraction("open", [opt.focused("lang", "span")]));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: { choices: [{ name: "Spanish (español) · es", value: "es" }] },
      });
    });

    it("returns no suggestions when the command has no autocomplete", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await postInteraction(server.url, autocompleteInteraction("ping", [opt.focused("x", "")]));

      expect(res.body).toEqual({ type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } });
    });

    it("returns no suggestions when autocomplete throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(commands.get("open")!, "autocomplete").mockRejectedValueOnce(new Error("API down"));

      const res = await postInteraction(server.url, autocompleteInteraction("open", [opt.focused("translation", "b")]));

      expect(res.body).toEqual({ type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } });
    });
  });
});
