import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  InteractionContextType,
  InteractionResponseType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import { setInlineVerses } from "../../../src/interactions/commands/setinlineverses.js";
import { commands } from "../../../src/interactions/commands/index.js";
import { useGateway, type GatewayNamespace } from "../../../src/gateway/control.js";
import { database } from "../../../src/storage/database.js";
import { inlineVersesEnabled, setInlineVersesEnabled } from "../../../src/storage/guild-settings.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { chatInputInteraction, opt, withPermissions } from "../../helpers/interactions.js";
import { postInteraction } from "../../helpers/server.js";

const GUILD = "300000000000000001"; // the guild_id the interaction helpers use

/** Runs the command as a member with Manage Server, optionally with a state. */
const run = (state?: string, permissions: bigint = PermissionFlagsBits.ManageGuild) =>
  setInlineVerses.execute(
    withPermissions(chatInputInteraction("setinlineverses", state === undefined ? [] : [opt.string("state", state)]), permissions),
  );

const reply = (content: string) => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
});

/** A stand-in GATEWAY binding that counts wake-ups. */
function fakeGateway(status = 204) {
  const wakes = vi.fn(async () => new Response(null, { status }));
  const namespace: GatewayNamespace = { idFromName: (name) => name, get: () => ({ fetch: wakes }) };
  useGateway(namespace);
  return wakes;
}

describe("/setinlineverses", () => {
  describe("definition", () => {
    it("is registered as 'setinlineverses'", async () => {
      expect(commands.get("setinlineverses")).toBe(setInlineVerses);
      const res = await postInteraction(withPermissions(chatInputInteraction("setinlineverses"), PermissionFlagsBits.ManageGuild));
      expect(res.body.data.content).not.toBe("Unknown command.");
    });

    it("is hidden from members without Manage Server, and only offered in servers", () => {
      expect(setInlineVerses.data.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
      expect(setInlineVerses.data.contexts).toEqual([InteractionContextType.Guild]);
    });

    it("has an optional 'state' option limited to on and off", () => {
      expect(setInlineVerses.data.options).toEqual([
        expect.objectContaining({
          name: "state",
          type: ApplicationCommandOptionType.String,
          choices: [{ name: "on", value: "on" }, { name: "off", value: "off" }],
        }),
      ]);
      expect(setInlineVerses.data.options?.[0]).not.toHaveProperty("required", true);
    });
  });

  describe("changing the setting", () => {
    it("turns inline verses on: /setinlineverses on", async () => {
      expect(await run("on")).toEqual(reply(
        "✅ Inline verses are now **on** for this server. When someone writes a reference like John 3:16, I'll reply with the passage.",
      ));
      expect(await inlineVersesEnabled(GUILD)).toBe(true);
    });

    it("turns them back off", async () => {
      await setInlineVersesEnabled(GUILD, true);
      expect(await run("off")).toEqual(reply(
        "✅ Inline verses are now **off** for this server. I'll no longer reply to references in messages.",
      ));
      expect(await inlineVersesEnabled(GUILD)).toBe(false);
    });

    it("wakes the Gateway connection so it starts or stops right away", async () => {
      const wakes = fakeGateway();
      await run("on");
      await run("off");
      expect(wakes).toHaveBeenCalledTimes(2);
    });

    it("still saves the setting if the connection can't be woken (it catches up within 5 minutes)", async () => {
      fakeGateway(500);
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await run("on")).toMatchObject({ data: { content: expect.stringContaining("now **on**") } });
      expect(await inlineVersesEnabled(GUILD)).toBe(true);
    });

    it("lets administrators change it too", async () => {
      await run("on", PermissionFlagsBits.Administrator);
      expect(await inlineVersesEnabled(GUILD)).toBe(true);
    });
  });

  describe("showing the setting", () => {
    it("says inline verses are off by default", async () => {
      expect(await run()).toEqual(reply(
        "Inline verses are **off** for this server. Use `/setinlineverses state: on` to have me reply to references like John 3:16.",
      ));
    });

    it("says when they're on, without changing anything or waking the connection", async () => {
      await setInlineVersesEnabled(GUILD, true);
      const wakes = fakeGateway();

      expect(await run()).toMatchObject({ data: { content: expect.stringContaining("are **on**") } });
      expect(wakes).not.toHaveBeenCalled();
    });
  });

  describe("who can use it", () => {
    it("refuses members without Manage Server, even if a server admin made the command visible to them", async () => {
      await expect(run("on", PermissionFlagsBits.ManageMessages)).rejects.toThrow(
        new UserFacingError("You need the **Manage Server** permission to change this setting."),
      );
      expect(await inlineVersesEnabled(GUILD)).toBe(false);
    });

    it("refuses outside servers", async () => {
      const dm = chatInputInteraction("setinlineverses", [opt.string("state", "on")], { guild_id: undefined, member: undefined });
      await expect(setInlineVerses.execute(dm)).rejects.toThrow(/use this command in a server/);
    });

    it("ignores an unexpected state value instead of storing it", async () => {
      expect(await run("maybe")).toMatchObject({ data: { content: expect.stringContaining("are **off**") } });
      expect(await database().prepare("SELECT COUNT(*) AS n FROM guild_settings").first()).toEqual({ n: 0 });
    });
  });
});
