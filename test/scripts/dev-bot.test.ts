import { describe, expect, it, vi } from "vitest";
import { ApplicationIntegrationType, PermissionFlagsBits } from "discord-api-types/v10";
import { commandList } from "../../src/interactions/commands/index.js";
import { registerCommands, setInstallSettings, setInteractionsEndpoint } from "../../src/scripts/discord-app.js";
import { botPermissions, guildInstallConfig, inviteUrl } from "../../src/scripts/install.js";
import { findTunnelUrl, isDevEndpoint } from "../../src/scripts/tunnel.js";

describe("findTunnelUrl", () => {
  it("finds the address in cloudflared's banner", () => {
    const line = "2026-10-13T10:00:00Z INF |  https://crazy-hat-blue-river.trycloudflare.com                                  |";
    expect(findTunnelUrl(line)).toBe("https://crazy-hat-blue-river.trycloudflare.com");
  });

  it("ignores other output", () => {
    expect(findTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com...")).toBeUndefined();
    expect(findTunnelUrl("INF Starting metrics server on 127.0.0.1:20241/metrics")).toBeUndefined();
  });
});

describe("isDevEndpoint", () => {
  it("allows an empty endpoint or an old quick tunnel", () => {
    expect(isDevEndpoint(undefined)).toBe(true);
    expect(isDevEndpoint(null)).toBe(true);
    expect(isDevEndpoint("https://old-words.trycloudflare.com/interactions")).toBe(true);
  });

  it("refuses anything that looks like the deployed bot", () => {
    expect(isDevEndpoint("https://sb-discord-app.example.workers.dev/interactions")).toBe(false);
    expect(isDevEndpoint("https://trycloudflare.com.evil.example/interactions")).toBe(false);
    expect(isDevEndpoint("not a url")).toBe(false);
  });
});

describe("Discord calls", () => {
  function mockDiscord(status = 200, body = "{}") {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body, { status }));
  }

  it("registers every command in one server, or globally", async () => {
    const spy = mockDiscord(200, "[]");

    expect(await registerCommands("tok", "app", "guild")).toBe(commandList.length);
    expect(await registerCommands("tok", "app")).toBe(commandList.length);

    const [[guildUrl, guildInit], [globalUrl]] = spy.mock.calls as [string, RequestInit][];
    expect(guildUrl).toBe("https://discord.com/api/v10/applications/app/guilds/guild/commands");
    expect(guildInit).toMatchObject({ method: "PUT", headers: { Authorization: "Bot tok" } });
    expect(JSON.parse(guildInit.body as string).map((c: { name: string }) => c.name)).toEqual(commandList.map((c) => c.data.name));
    expect(globalUrl).toBe("https://discord.com/api/v10/applications/app/commands");
  });

  it("sets the Interactions Endpoint URL on the bot's own application", async () => {
    const spy = mockDiscord();
    await setInteractionsEndpoint("tok", "https://x.trycloudflare.com/interactions");
    expect(spy.mock.calls[0]![0]).toBe("https://discord.com/api/v10/applications/@me");
    expect(spy.mock.calls[0]![1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ interactions_endpoint_url: "https://x.trycloudflare.com/interactions" }) });
  });

  it("reports Discord's reason when it refuses", async () => {
    mockDiscord(400, '{"message":"interactions_endpoint_url could not be verified"}');
    await expect(setInteractionsEndpoint("tok", "https://x")).rejects.toThrow(/\(400\).*could not be verified/);
  });
});

describe("install settings", () => {
  const { ViewChannel, SendMessages, SendMessagesInThreads, ReadMessageHistory } = PermissionFlagsBits;
  const permissions = (ViewChannel | SendMessages | SendMessagesInThreads | ReadMessageHistory).toString();

  it("asks for the bot and its commands, with the permissions the bot uses and nothing more", () => {
    expect(botPermissions().toString()).toBe(permissions);
    expect(guildInstallConfig({})).toEqual({
      [ApplicationIntegrationType.GuildInstall]: { oauth2_install_params: { scopes: ["bot", "applications.commands"], permissions } },
    });
  });

  it("replaces the old guild install settings but keeps the user install ones", () => {
    const userInstall = { oauth2_install_params: { scopes: ["applications.commands" as never], permissions: "0" } };
    const config = guildInstallConfig({
      integration_types_config: {
        [ApplicationIntegrationType.GuildInstall]: { oauth2_install_params: { scopes: ["applications.commands" as never], permissions: "8" } },
        [ApplicationIntegrationType.UserInstall]: userInstall,
      },
    });
    expect(config[ApplicationIntegrationType.GuildInstall]!.oauth2_install_params!.permissions).toBe(permissions);
    expect(config[ApplicationIntegrationType.UserInstall]).toEqual(userInstall);
  });

  it("sends them to the bot's own application", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
    await setInstallSettings("tok", guildInstallConfig({}));
    expect(spy.mock.calls[0]![0]).toBe("https://discord.com/api/v10/applications/@me");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ integration_types_config: guildInstallConfig({}) });
  });

  it("builds an invite link, locked to the dev server when given", () => {
    const url = new URL(inviteUrl("app", "guild"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "app",
      scope: "bot applications.commands",
      permissions,
      integration_type: "0",
      guild_id: "guild",
      disable_guild_select: "true",
    });
    expect(new URL(inviteUrl("app")).searchParams.has("guild_id")).toBe(false);
  });
});
