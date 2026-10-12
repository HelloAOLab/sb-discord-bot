import { describe, expect, it } from "vitest";
import { database } from "../../src/storage/database.js";
import {
  anyInlineVersesEnabled,
  inlineVersesEnabled,
  seedBibleLinksEnabled,
  setInlineVersesEnabled,
  setSeedBibleLinksEnabled,
} from "../../src/storage/guild-settings.js";

// test/setup.ts gives every test a fresh database built from migrations/.

const GUILD = "300000000000000001";
const OTHER_GUILD = "300000000000000002";

describe("Seed Bible links setting", () => {
  it("is on by default", async () => {
    expect(await seedBibleLinksEnabled(GUILD)).toBe(true);
  });

  it("can be turned off and back on", async () => {
    await setSeedBibleLinksEnabled(GUILD, false);
    expect(await seedBibleLinksEnabled(GUILD)).toBe(false);

    await setSeedBibleLinksEnabled(GUILD, true);
    expect(await seedBibleLinksEnabled(GUILD)).toBe(true);
  });

  it("is separate for each server", async () => {
    await setSeedBibleLinksEnabled(GUILD, false);
    expect(await seedBibleLinksEnabled(OTHER_GUILD)).toBe(true);
  });

  it("is always on outside servers (DMs)", async () => {
    expect(await seedBibleLinksEnabled(undefined)).toBe(true);
  });

  it("stores one row per server and setting, updated in place", async () => {
    await setSeedBibleLinksEnabled(GUILD, false);
    await setSeedBibleLinksEnabled(GUILD, true);
    await setSeedBibleLinksEnabled(GUILD, false);

    const { results } = await database().prepare("SELECT guild_id, name, value FROM guild_settings").all();
    expect(results).toEqual([{ guild_id: GUILD, name: "seed_bible_links", value: "off" }]);
  });
});

describe("Inline verses setting", () => {
  it("is off by default", async () => {
    expect(await inlineVersesEnabled(GUILD)).toBe(false);
  });

  it("can be turned on and back off", async () => {
    await setInlineVersesEnabled(GUILD, true);
    expect(await inlineVersesEnabled(GUILD)).toBe(true);

    await setInlineVersesEnabled(GUILD, false);
    expect(await inlineVersesEnabled(GUILD)).toBe(false);
  });

  it("is separate for each server, and from the Seed Bible links setting", async () => {
    await setInlineVersesEnabled(GUILD, true);
    expect(await inlineVersesEnabled(OTHER_GUILD)).toBe(false);
    expect(await seedBibleLinksEnabled(GUILD)).toBe(true);
  });

  it("tells whether any server has it on, which decides if the Gateway connection runs", async () => {
    expect(await anyInlineVersesEnabled()).toBe(false);

    await setSeedBibleLinksEnabled(GUILD, true); // "on" for a different setting doesn't count
    await setInlineVersesEnabled(OTHER_GUILD, false);
    expect(await anyInlineVersesEnabled()).toBe(false);

    await setInlineVersesEnabled(GUILD, true);
    expect(await anyInlineVersesEnabled()).toBe(true);
  });
});
