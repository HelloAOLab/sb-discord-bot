import { describe, expect, it, vi } from "vitest";
import { ComponentType, MessageFlags, MessageType } from "discord-api-types/v10";
import { replyToReferences } from "../../src/inline/messages.js";
import { database } from "../../src/storage/database.js";
import { setInlineVersesEnabled, setSeedBibleLinksEnabled } from "../../src/storage/guild-settings.js";
import { mockFetch } from "../helpers/bible-api.js";
import { gatewayMessage, TEST_GUILD } from "../helpers/gateway.js";

const TOKEN = "test-bot-token";

describe("replyToReferences", () => {
  it("replies to a reference in a server with inline verses on", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    const { discordCalls } = mockFetch();

    expect(await replyToReferences(gatewayMessage("John 3:16 is my favourite"), TOKEN)).toBe(true);

    expect(discordCalls).toEqual([
      {
        url: "https://discord.com/api/v10/channels/400000000000000001/messages",
        method: "POST",
        body: {
          flags: MessageFlags.IsComponentsV2,
          components: [
            expect.objectContaining({
              type: ComponentType.Container,
              components: expect.arrayContaining([
                { type: ComponentType.TextDisplay, content: expect.stringMatching(/^### John 3:16 \((AAB)\)\nFor God so loved the world/) },
              ]),
            }),
          ],
          message_reference: { message_id: "700000000000000001", fail_if_not_exists: false },
          allowed_mentions: { parse: [], replied_user: false },
        },
      },
    ]);
  });

  it("sends the bot token, which channel messages need", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    const { spy } = mockFetch();

    await replyToReferences(gatewayMessage("John 3:16"), TOKEN);

    const discordCall = spy.mock.calls.find(([url]) => String(url).startsWith("https://discord.com/"))!;
    expect(new Headers(discordCall[1]?.headers).get("Authorization")).toBe(`Bot ${TOKEN}`);
  });

  it("sends one reply per reference, each replying to the message: gen 1 1 and exo 2 3", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    const { discordCalls } = mockFetch();

    expect(await replyToReferences(gatewayMessage("telll me what happen in gen 1 1 and exo 2 3"), TOKEN)).toBe(true);

    expect(discordCalls.map((call) => call.body.components[0].components[0].content.split("\n")[0])).toEqual([
      "### Genesis 1:1 (AAB)",
      "### Exodus 2:3 (AAB)",
    ]);
    for (const call of discordCalls) expect(call.body.message_reference).toEqual({ message_id: "700000000000000001", fail_if_not_exists: false });
  });

  it("uses the server's link setting", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    await setSeedBibleLinksEnabled(TEST_GUILD, false);
    const { discordCalls } = mockFetch();

    await replyToReferences(gatewayMessage("genesis"), TOKEN);

    expect(discordCalls[0]!.body.components[0].components).toEqual([
      expect.objectContaining({ type: ComponentType.TextDisplay, content: expect.stringContaining("Open in Seed Bible: <https://seedbible.org/genesis/1?source=discord_bot>") }),
    ]);
  });

  it("reads both settings in one database query", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    mockFetch();
    const prepare = vi.spyOn(database(), "prepare");

    await replyToReferences(gatewayMessage("John 3:16"), TOKEN);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  describe("stays quiet", () => {
    it("in servers that haven't turned inline verses on (the default)", async () => {
      const { discordCalls } = mockFetch();
      expect(await replyToReferences(gatewayMessage("John 3:16"), TOKEN)).toBe(false);
      expect(discordCalls).toEqual([]);
    });

    it("in servers that turned it off", async () => {
      await setInlineVersesEnabled(TEST_GUILD, true);
      await setInlineVersesEnabled(TEST_GUILD, false);
      const { discordCalls } = mockFetch();
      expect(await replyToReferences(gatewayMessage("John 3:16"), TOKEN)).toBe(false);
      expect(discordCalls).toEqual([]);
    });

    it.each([
      ["a bot (including itself)", { author: { ...gatewayMessage("").author, bot: true } }],
      ["a webhook", { webhook_id: "800000000000000001" }],
      ["a DM", { guild_id: undefined }],
      ["a system message", { type: MessageType.ChannelPinnedMessage }],
    ])("for messages from %s", async (_, overrides) => {
      await setInlineVersesEnabled(TEST_GUILD, true);
      const { discordCalls } = mockFetch();
      expect(await replyToReferences(gatewayMessage("John 3:16", overrides), TOKEN)).toBe(false);
      expect(discordCalls).toEqual([]);
    });

    it("for messages without a reference, without loading anything", async () => {
      await setInlineVersesEnabled(TEST_GUILD, true);
      const { spy } = mockFetch();
      expect(await replyToReferences(gatewayMessage("hello everyone"), TOKEN)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("when every reference points at a chapter that doesn't exist", async () => {
      await setInlineVersesEnabled(TEST_GUILD, true);
      const { discordCalls } = mockFetch();
      expect(await replyToReferences(gatewayMessage("John 99:1"), TOKEN)).toBe(false);
      expect(discordCalls).toEqual([]);
    });
  });

  it("also answers replies to other messages", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    const { discordCalls } = mockFetch();
    await replyToReferences(gatewayMessage("John 3:16", { type: MessageType.Reply }), TOKEN);
    expect(discordCalls).toHaveLength(1);
  });

  it("logs a reply Discord rejects (e.g. no permission to post) and still sends the others", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    const { spy, discordCalls } = mockFetch();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = spy.getMockImplementation()!;
    let posts = 0;
    spy.mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://discord.com/") && posts++ === 0) return new Response("Missing Permissions", { status: 403 });
      return answer(input, init);
    });

    expect(await replyToReferences(gatewayMessage("gen 1 1 and exo 2 3"), TOKEN)).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Couldn't reply"), expect.objectContaining({ message: expect.stringContaining("403") }));
    expect(discordCalls).toHaveLength(1);
  });

  it("says it didn't reply when every reply is rejected", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    mockFetch({ discordStatus: 403 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await replyToReferences(gatewayMessage("John 3:16"), TOKEN)).toBe(false);
  });
});
