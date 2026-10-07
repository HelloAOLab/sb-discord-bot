import { RouteBases, Routes } from "discord-api-types/v10";
import { config } from "../utils/config.js";
import { commandList } from "../interactions/commands/index.js";

const body = commandList.map((command) => command.data);

// Global commands can take up to an hour to show up in Discord after registering.
console.log(`Registering ${body.length} command(s)...`);

const res = await fetch(RouteBases.api + Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
  method: "PUT",
  headers: {
    Authorization: `Bot ${config.DISCORD_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error(`Failed (${res.status}):`, await res.text());
  process.exitCode = 1;
} else {
  console.log("Done.");
}
