import { beforeEach, describe, expect, it } from "vitest";
import { database } from "../../src/storage/database.js";
import { seedBibleLinksEnabled, setSeedBibleLinksEnabled } from "../../src/storage/guild-settings.js";

const GUILD = "300000000000000001";
const OTHER_GUILD = "300000000000000002";

beforeEach(() => {
  database().exec("DELETE FROM guild_settings");
});

describe("Seed Bible links setting", () => {
  it("is on by default", () => {
    expect(seedBibleLinksEnabled(GUILD)).toBe(true);
  });

  it("can be turned off and back on", () => {
    setSeedBibleLinksEnabled(GUILD, false);
    expect(seedBibleLinksEnabled(GUILD)).toBe(false);

    setSeedBibleLinksEnabled(GUILD, true);
    expect(seedBibleLinksEnabled(GUILD)).toBe(true);
  });

  it("is separate for each server", () => {
    setSeedBibleLinksEnabled(GUILD, false);
    expect(seedBibleLinksEnabled(OTHER_GUILD)).toBe(true);
  });

  it("is always on outside servers (DMs)", () => {
    expect(seedBibleLinksEnabled(undefined)).toBe(true);
  });

  it("stores one row per server and setting, updated in place", () => {
    setSeedBibleLinksEnabled(GUILD, false);
    setSeedBibleLinksEnabled(GUILD, true);
    setSeedBibleLinksEnabled(GUILD, false);

    expect(database().prepare("SELECT guild_id, name, value FROM guild_settings").all()).toEqual([
      { guild_id: GUILD, name: "seed_bible_links", value: "off" },
    ]);
  });
});
