import type { Command } from "./types.js";
import { open } from "./open.js";
import { setSeedBibleLinks } from "./setseedbiblelinks.js";

// Register new commands here.
export const commandList: Command[] = [open, setSeedBibleLinks];

export const commands = new Map<string, Command>(
  commandList.map((command) => [command.data.name, command]),
);
