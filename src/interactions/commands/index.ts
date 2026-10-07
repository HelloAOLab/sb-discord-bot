import type { Command } from "./types.js";
import { echo } from "./echo.js";
import { open } from "./open.js";
import { ping } from "./ping.js";
import { setSeedBibleLinks } from "./setseedbiblelinks.js";

// Register new commands here.
export const commandList: Command[] = [ping, echo, open, setSeedBibleLinks];

export const commands = new Map<string, Command>(
  commandList.map((command) => [command.data.name, command]),
);
