import type { Command } from "./types.js";
import { launchSession } from "./launchsession.js";
import { open } from "./open.js";
import { preferences } from "./preferences.js";
import { setInlineVerses } from "./setinlineverses.js";
import { setSeedBibleLinks } from "./setseedbiblelinks.js";

// Register new commands here.
export const commandList: Command[] = [open, setSeedBibleLinks, setInlineVerses, launchSession, preferences];

export const commands = new Map<string, Command>(
  commandList.map((command) => [command.data.name, command]),
);
