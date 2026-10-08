import { describe, expect, it, vi } from "vitest";
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
import { postInteraction, request, testEnv } from "../helpers/server.js";

describe("POST /interactions", () => {
  describe("signature verification", () => {
    it("answers Discord's PING with PONG", async () => {
      const res = await postInteraction({ type: InteractionType.Ping });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: InteractionResponseType.Pong });
    });

    it("rejects a request with an invalid signature", async () => {
      const res = await postInteraction({ type: InteractionType.Ping }, { badSignature: true });
      expect(res.status).toBe(401);
    });

    // Guards server/app.ts: the signature covers the exact bytes Discord sent, so verifying
    // re-serialized JSON instead would reject this request.
    it("verifies against the raw body bytes, not re-serialized JSON", async () => {
      const payload = { type: InteractionType.Ping };
      const res = await postInteraction(payload, { rawBody: JSON.stringify(payload, null, 2) });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: InteractionResponseType.Pong });
    });

    it("rejects an unsigned request", async () => {
      const res = await postInteraction({ type: InteractionType.Ping }, { unsigned: true });
      expect(res.status).toBe(401);
    });
  });

  describe("command routing", () => {
    it("routes a slash command to its handler", async () => {
      const res = await postInteraction(
        withPermissions(chatInputInteraction("setseedbiblelinks"), PermissionFlagsBits.ManageGuild),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: expect.stringContaining("Seed Bible link buttons are **on**") },
      });
    });

    it("replies privately for an unknown command", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await postInteraction(chatInputInteraction("does-not-exist"));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
    });

    it("replies privately when a command throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(commands.get("setseedbiblelinks")!, "execute").mockRejectedValueOnce(new Error("boom"));

      const res = await postInteraction(chatInputInteraction("setseedbiblelinks"));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
      expect(res.body.data.content).toMatch(/went wrong/);
    });

    it("shows a UserFacingError's own message privately, without logging it", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(commands.get("setseedbiblelinks")!, "execute").mockRejectedValueOnce(new UserFacingError('Try "John 3".'));

      const res = await postInteraction(chatInputInteraction("setseedbiblelinks"));

      expect(res.body).toEqual({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: 'Try "John 3".', flags: MessageFlags.Ephemeral },
      });
      expect(log).not.toHaveBeenCalled();
    });

    it("sends a deferred response, then edits it in work kept alive with waitUntil()", async () => {
      const { discordCalls } = mockFetch();

      const res = await postInteraction(chatInputInteraction("open"));

      expect(res.body).toEqual({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: MessageFlags.Ephemeral },
      });
      await res.background;
      expect(discordCalls).toHaveLength(1);
      expect(discordCalls[0]).toMatchObject({ method: "PATCH", body: { content: expect.stringMatching(/^Choose a book\./) } });
    });

    it("remembers a server's Seed Bible links setting between requests", async () => {
      const setting = (state: string) =>
        withPermissions(chatInputInteraction("setseedbiblelinks", [opt.string("state", state)]), PermissionFlagsBits.ManageGuild);
      /** Picks John 3 in the picker and returns the public message it posts. */
      async function pickJohn3() {
        const { discordCalls } = mockFetch();
        await (await postInteraction(selectInteraction("open-picker:chapter:::JHN:0:0", ["3"]))).background;
        vi.restoreAllMocks();
        return discordCalls.find((c) => c.method === "POST")!.body;
      }

      expect((await postInteraction(setting("off"))).body.data.content).toMatch(/now \*\*off\*\*/);
      expect(await pickJohn3()).toEqual({
        content: "Open John 3 in Seed Bible: <https://seedbible.org/?book=JHN&chapter=3&source=discord_bot>",
        allowed_mentions: { parse: [] },
      });

      await postInteraction(setting("on"));
      expect((await pickJohn3()).components[0].components[0]).toMatchObject({ label: "Open →" });
    });

    it("rejects interaction types it doesn't handle", async () => {
      const res = await postInteraction({ ...chatInputInteraction("open"), type: InteractionType.ModalSubmit });
      expect(res.status).toBe(400);
    });
  });

  describe("component routing", () => {
    it("routes a menu choice to the component named at the start of its custom_id, and runs its deferred work", async () => {
      const { discordCalls } = mockFetch();

      const res = await postInteraction(selectInteraction("open-picker:book::::0:0", ["JHN"]));

      expect(res.body).toEqual({ type: InteractionResponseType.DeferredMessageUpdate });
      await res.background;
      expect(discordCalls).toHaveLength(1);
      expect(discordCalls[0]).toMatchObject({ method: "PATCH", body: { content: "Choose a chapter of **John**." } });
    });

    it("replies privately for an unknown component", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await postInteraction(buttonInteraction("removed-button:1"));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
      expect(res.body.data.content).toMatch(/no longer works/);
    });

    it("replies privately when a component throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(components.get("open-picker")!, "execute").mockRejectedValueOnce(new Error("boom"));

      const res = await postInteraction(selectInteraction("open-picker:book::::0:0", ["JHN"]));

      expect(res.status).toBe(200);
      expect(res.body.data.flags).toBe(MessageFlags.Ephemeral);
      expect(res.body.data.content).toMatch(/went wrong/);
    });
  });

  describe("autocomplete routing", () => {
    it("returns the command's suggestions", async () => {
      const res = await postInteraction(autocompleteInteraction("open", [opt.focused("lang", "span")]));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: { choices: [{ name: "Spanish (español) · es", value: "es" }] },
      });
    });

    it("returns no suggestions when the command has no autocomplete", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await postInteraction(autocompleteInteraction("setseedbiblelinks", [opt.focused("state", "")]));

      expect(res.body).toEqual({ type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } });
    });

    it("returns no suggestions when autocomplete throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(commands.get("open")!, "autocomplete").mockRejectedValueOnce(new Error("API down"));

      const res = await postInteraction(autocompleteInteraction("open", [opt.focused("translation", "b")]));

      expect(res.body).toEqual({ type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } });
    });
  });

  describe("Worker configuration", () => {
    it("fails loudly (500, logged) when the public key secret is missing", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await postInteraction({ type: InteractionType.Ping }, { env: { DB: testEnv().DB } });

      expect(res.status).toBe(500);
      expect(String(log.mock.calls[0]?.[1])).toMatch(/DISCORD_PUBLIC_KEY is missing/);
    });

    it("fails loudly when the D1 binding is missing", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await postInteraction({ type: InteractionType.Ping }, { env: { DISCORD_PUBLIC_KEY: testEnv().DISCORD_PUBLIC_KEY } });

      expect(res.status).toBe(500);
      expect(String(log.mock.calls[0]?.[1])).toMatch(/DB is missing/);
    });
  });
});

describe("other routes", () => {
  it("reports health", async () => {
    expect(await request("/health")).toMatchObject({ status: 200, body: { status: "ok" } });
  });

  it("answers 404 for unknown paths, and for GET /interactions", async () => {
    expect((await request("/nope")).status).toBe(404);
    expect((await request("/interactions")).status).toBe(404);
  });
});
