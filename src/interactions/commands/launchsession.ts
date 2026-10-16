import { InteractionContextType } from "discord-api-types/v10";
import { sessionBuilderModal } from "../modals/session-builder.js";
import type { Command } from "./types.js";

// /launchsession opens a form (modals/session-builder.ts) to plan a reading session: a chapter
// everyone opens together in Seed Bible, now or at a time picked next. People join with a button,
// are pinged when it starts, and each gets a link in their own language and translation.
// See src/sessions/ for how the pieces fit.

export const launchSession: Command = {
  data: {
    name: "launchsession",
    description: "Plan a session to read a chapter together in Seed Bible, now or later",
    // Sessions are announced in a server channel.
    contexts: [InteractionContextType.Guild],
  },

  execute() {
    return sessionBuilderModal();
  },
};
