import type { Command } from "./types.js";
import { open } from "./open.js";
import { setInlineVerses } from "./setinlineverses.js";
import { setSeedBibleLinks } from "./setseedbiblelinks.js";

// Register new commands here.
export const commandList: Command[] = [open, setSeedBibleLinks, setInlineVerses];

export const commands = new Map<string, Command>(
  commandList.map((command) => [command.data.name, command]),
);
