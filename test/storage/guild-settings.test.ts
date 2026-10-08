import { describe, expect, it } from "vitest";
import { database } from "../../src/storage/database.js";
import { seedBibleLinksEnabled, setSeedBibleLinksEnabled } from "../../src/storage/guild-settings.js";

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
