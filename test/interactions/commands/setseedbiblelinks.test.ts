import { describe, expect, it } from "vitest";
import {
  ApplicationCommandOptionType,
  InteractionContextType,
  InteractionResponseType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import { setSeedBibleLinks } from "../../../src/interactions/commands/setseedbiblelinks.js";
import { commands } from "../../../src/interactions/commands/index.js";
import { database } from "../../../src/storage/database.js";
import { seedBibleLinksEnabled, setSeedBibleLinksEnabled } from "../../../src/storage/guild-settings.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { chatInputInteraction, opt, withPermissions } from "../../helpers/interactions.js";

const GUILD = "300000000000000001"; // the guild_id the interaction helpers use

/** Runs the command as a member with Manage Server, optionally with a state. */
const run = (state?: string, permissions: bigint = PermissionFlagsBits.ManageGuild) =>
  setSeedBibleLinks.execute(
    withPermissions(chatInputInteraction("setseedbiblelinks", state === undefined ? [] : [opt.string("state", state)]), permissions),
  );

const reply = (content: string) => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
});

describe("/setseedbiblelinks", () => {
  describe("definition", () => {
    it("is registered as 'setseedbiblelinks'", () => {
      expect(commands.get("setseedbiblelinks")).toBe(setSeedBibleLinks);
    });

    it("is hidden from members without Manage Server, and only offered in servers", () => {
      expect(setSeedBibleLinks.data.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
      expect(setSeedBibleLinks.data.contexts).toEqual([InteractionContextType.Guild]);
    });

    it("has an optional 'state' option limited to on and off", () => {
      expect(setSeedBibleLinks.data.options).toEqual([
        expect.objectContaining({
          name: "state",
          type: ApplicationCommandOptionType.String,
          choices: [{ name: "on", value: "on" }, { name: "off", value: "off" }],
        }),
      ]);
      expect(setSeedBibleLinks.data.options?.[0]).not.toHaveProperty("required", true);
    });
  });

  describe("changing the setting", () => {
    it("turns links off: /setseedbiblelinks off", async () => {
      expect(await run("off")).toEqual(reply(
        "✅ Seed Bible link buttons are now **off** for this server. Links will be posted as plain text instead.",
      ));
      expect(await seedBibleLinksEnabled(GUILD)).toBe(false);
    });

    it("turns links back on", async () => {
      await setSeedBibleLinksEnabled(GUILD, false);

      expect(await run("on")).toEqual(reply("✅ Seed Bible link buttons are now **on** for this server."));
      expect(await seedBibleLinksEnabled(GUILD)).toBe(true);
    });

    it("lets administrators change it too", async () => {
      await run("off", PermissionFlagsBits.Administrator);
      expect(await seedBibleLinksEnabled(GUILD)).toBe(false);
    });
  });

  describe("showing the setting", () => {
    it("says links are on by default", async () => {
      expect(await run()).toEqual(reply(
        "Seed Bible link buttons are **on** for this server. Use `/setseedbiblelinks state: off` to post plain-text links instead.",
      ));
    });

    it("says when links are off, without changing anything", async () => {
      await setSeedBibleLinksEnabled(GUILD, false);

      expect(await run()).toMatchObject({ data: { content: expect.stringContaining("**off**") } });
      expect(await seedBibleLinksEnabled(GUILD)).toBe(false);
    });
  });

  describe("who can use it", () => {
    it("refuses members without Manage Server, even if a server admin made the command visible to them", async () => {
      await expect(run("off", PermissionFlagsBits.ManageMessages)).rejects.toThrow(
        new UserFacingError("You need the **Manage Server** permission to change this setting."),
      );
      expect(await seedBibleLinksEnabled(GUILD)).toBe(true);
    });

    it("refuses outside servers", async () => {
      const dm = chatInputInteraction("setseedbiblelinks", [opt.string("state", "off")], { guild_id: undefined, member: undefined });
      await expect(setSeedBibleLinks.execute(dm)).rejects.toThrow(/use this command in a server/);
    });

    it("ignores an unexpected state value instead of storing it", async () => {
      expect(await run("maybe")).toMatchObject({ data: { content: expect.stringContaining("are **on**") } });
      expect(await database().prepare("SELECT COUNT(*) AS n FROM guild_settings").first()).toEqual({ n: 0 });
    });
  });
});
