import { describe, expect, it } from "vitest";
import { PermissionFlagsBits } from "discord-api-types/v10";
import { hasPermission } from "../../src/interactions/permissions.js";
import { chatInputInteraction, withPermissions } from "../helpers/interactions.js";

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
