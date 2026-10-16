import { describe, expect, it } from "vitest";
import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { commands } from "../../../src/interactions/commands/index.js";
import { preferences } from "../../../src/interactions/commands/preferences.js";
import { runDeferredWork } from "../../../src/interactions/deferred.js";
import { setUserPreferences, userPreferences } from "../../../src/storage/user-settings.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { mockFetch } from "../../helpers/bible-api.js";
import { autocompleteInteraction, chatInputInteraction, opt } from "../../helpers/interactions.js";
import { TEST_USER } from "../../helpers/sessions.js";

const run = (...options: Parameters<typeof chatInputInteraction>[1] & unknown[]) =>
  preferences.execute(chatInputInteraction("preferences", options));

const content = (response: Awaited<ReturnType<typeof run>>) => (response as any).data.content as string;

describe("/preferences", () => {
  it("is registered with its options", () => {
    expect(commands.get("preferences")).toBe(preferences);
    expect(preferences.data.options!.map((o) => [o.name, o.type])).toEqual([
      ["translation", ApplicationCommandOptionType.String],
      ["lang", ApplicationCommandOptionType.String],
      ["timezone", ApplicationCommandOptionType.String],
      ["reset", ApplicationCommandOptionType.Boolean],
    ]);
  });

  it("shows the defaults privately when nothing is set", async () => {
    const response = await run();
    expect(response).toMatchObject({ type: InteractionResponseType.ChannelMessageWithSource, data: { flags: MessageFlags.Ephemeral } });
    expect(content(response)).toContain("**Bible translation:** AAB (the default)");
    expect(content(response)).toContain("**Seed Bible language:** English");
    expect(content(response)).toContain("**Time zone:** not set");
  });

  it("saves a language and a time zone at once", async () => {
    const response = await run(opt.string("lang", "ES"), opt.string("timezone", "america/new_york"));
    expect(content(response)).toMatch(/^✅ Saved\./);
    expect(content(response)).toContain("**Time zone:** America/New_York");
    expect(await userPreferences(TEST_USER)).toEqual({ lang: "es", timeZone: "America/New_York" });
  });

  it("checks a translation with the Bible API, then saves its exact ID", async () => {
    const { discordCalls } = mockFetch();
    const response = await run(opt.string("translation", "bsb"));
    expect(response).toEqual({ type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: MessageFlags.Ephemeral } });
    await runDeferredWork(response);

    expect(await userPreferences(TEST_USER)).toEqual({ translation: "BSB" });
    expect(discordCalls.at(-1)!.body.content).toContain("**Bible translation:** BSB");
  });

  it("saves nothing when the translation isn't found", async () => {
    const { discordCalls } = mockFetch();
    await runDeferredWork(await run(opt.string("translation", "nope"), opt.string("lang", "es")));
    expect(discordCalls.at(-1)!.body.content).toMatch(/couldn't find a translation called "nope"/);
    expect(await userPreferences(TEST_USER)).toEqual({});
  });

  it("explains an unknown language or time zone at once", async () => {
    await expect(run(opt.string("lang", "klingon"))).rejects.toThrow(UserFacingError);
    await expect(run(opt.string("timezone", "Mars/Base"))).rejects.toThrow(/I don't know the time zone "Mars\/Base"/);
  });

  it("resets everything to the defaults", async () => {
    await setUserPreferences(TEST_USER, { translation: "BSB", lang: "es", timeZone: "UTC" });
    const response = await run(opt.boolean("reset", true));
    expect(content(response)).toMatch(/^✅ Your preferences are reset/);
    expect(await userPreferences(TEST_USER)).toEqual({});
  });

  it("suggests time zones by city or label, with their UTC offset", async () => {
    const choices = await preferences.autocomplete!(autocompleteInteraction("preferences", [opt.focused("timezone", "eastern")]));
    expect(choices[0]).toEqual({ name: expect.stringMatching(/^Eastern Time \(New York, Toronto\) · America\/New_York \(UTC−[45]\)$/), value: "America/New_York" });

    const vienna = await preferences.autocomplete!(autocompleteInteraction("preferences", [opt.focused("timezone", "vienna")]));
    expect(vienna.map((c) => c.value)).toContain("Europe/Vienna");
  });

  it("suggests languages and translations like /open", async () => {
    mockFetch();
    const langs = await preferences.autocomplete!(autocompleteInteraction("preferences", [opt.focused("lang", "span")]));
    expect(langs[0]!.value).toBe("es");
    const translations = await preferences.autocomplete!(autocompleteInteraction("preferences", [opt.focused("translation", "bsb")]));
    expect(translations[0]!.value).toBe("BSB");
  });
});
