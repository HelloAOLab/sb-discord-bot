import { describe, expect, it } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord-api-types/v10";
import { appCanPost, hasPermission } from "../../src/interactions/permissions.js";
import { chatInputInteraction, withAppPermissions, withPermissions } from "../helpers/interactions.js";

const { ManageGuild, ManageMessages, Administrator } = PermissionFlagsBits;

describe("hasPermission", () => {
  it("is true when the member has the permission", () => {
    expect(hasPermission(withPermissions(chatInputInteraction("x"), ManageGuild | ManageMessages), ManageGuild)).toBe(true);
  });

  it("is false when the member lacks it", () => {
    expect(hasPermission(withPermissions(chatInputInteraction("x"), ManageMessages), ManageGuild)).toBe(false);
    expect(hasPermission(chatInputInteraction("x"), ManageGuild)).toBe(false); // the helper's member has "0"
  });

  it("treats Administrator as every permission", () => {
    expect(hasPermission(withPermissions(chatInputInteraction("x"), Administrator), ManageGuild)).toBe(true);
  });

  it("is false outside servers, where there's no member", () => {
    expect(hasPermission(chatInputInteraction("x", [], { guild_id: undefined, member: undefined }), ManageGuild)).toBe(false);
  });
});

describe("appCanPost", () => {
  const { ViewChannel, SendMessages, SendMessagesInThreads } = PermissionFlagsBits;
  const inChannel = (type: ChannelType, permissions: bigint) =>
    withAppPermissions(chatInputInteraction("x", [], { channel: { id: "1", type } as any }), permissions);

  it("needs View Channel and Send Messages in a channel", () => {
    expect(appCanPost(inChannel(ChannelType.GuildText, ViewChannel | SendMessages))).toBe(true);
    expect(appCanPost(inChannel(ChannelType.GuildText, SendMessages))).toBe(false);
    expect(appCanPost(inChannel(ChannelType.GuildText, ViewChannel | SendMessagesInThreads))).toBe(false);
  });

  it("needs Send Messages in Threads in a thread", () => {
    expect(appCanPost(inChannel(ChannelType.PublicThread, ViewChannel | SendMessagesInThreads))).toBe(true);
    expect(appCanPost(inChannel(ChannelType.PublicThread, ViewChannel | SendMessages))).toBe(false);
  });

  it("treats Administrator as every permission, and no permissions as none", () => {
    expect(appCanPost(inChannel(ChannelType.GuildText, Administrator))).toBe(true);
    expect(appCanPost(chatInputInteraction("x"))).toBe(false); // the helper's app has "0"
  });
});
