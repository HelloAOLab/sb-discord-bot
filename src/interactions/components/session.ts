import {
  InteractionResponseType,
  PermissionFlagsBits,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import {
  SESSION_ACTIONS,
  SESSION_BUTTONS_ID,
  announcementMessage,
  personalLinkMessage,
  type SessionAction,
} from "../../sessions/messages.js";
import { seedBibleLinksEnabled } from "../../storage/guild-settings.js";
import { addParticipant, cancelSession, getSession, participants, removeParticipant, type Session } from "../../storage/sessions.js";
import { userPreferences } from "../../storage/user-settings.js";
import { UserFacingError } from "../../utils/errors.js";
import { hasPermission } from "../permissions.js";
import { interactionUserId } from "../user.js";
import type { Component } from "./types.js";

// The buttons on a reading session's messages (sessions/messages.ts draws them):
//
//   Join            before it starts: adds the user and redraws the announcement's "Going" list;
//                   once it has started: adds them and replies privately with their link
//   Leave           before it starts: removes the user and redraws the list
//   Cancel session  the planner, or anyone with Manage Events, cancels it before it starts
//   Get my link     replies privately with the session's Seed Bible link, in the user's own
//                   language and translation (/preferences)
//
// custom_id: "session:<action>:<session id>". Keep it stable once released.

export const sessionButtons: Component = {
  id: SESSION_BUTTONS_ID,

  async execute(interaction, [action = "", sessionId = ""]) {
    if (!(SESSION_ACTIONS as readonly string[]).includes(action)) throw new UserFacingError("This button no longer works.");
    const session = await getSession(sessionId);
    // A draft has no public buttons yet, so a click on one means a forged or very old custom_id.
    if (!session || session.status === "draft") throw new UserFacingError("This session no longer exists.");
    if (session.status === "cancelled") throw new UserFacingError("This session was cancelled.");

    const userId = interactionUserId(interaction);
    const started = hasStarted(session);
    switch (action as SessionAction) {
      case "join":
        await addParticipant(session.id, userId);
        if (started) return linkReply(interaction, session, userId);
        return redraw(session);

      case "leave":
        if (started) throw new UserFacingError("This session has already started.");
        await removeParticipant(session.id, userId);
        return redraw(session);

      case "cancel":
        if (userId !== session.creatorId && !hasPermission(interaction, PermissionFlagsBits.ManageEvents)) {
          throw new UserFacingError("Only the person who planned this session, or someone with **Manage Events**, can cancel it.");
        }
        if (started || !(await cancelSession(session.id))) throw new UserFacingError("This session has already started.");
        console.log(`[sessions] Session ${session.id} cancelled in guild ${session.guildId}`);
        return redraw({ ...session, status: "cancelled" });

      case "link":
        if (!started) {
          throw new UserFacingError(
            `This session starts <t:${session.startAt}:R>. Click **Join** on its announcement to be pinged when it starts.`,
          );
        }
        await addParticipant(session.id, userId);
        return linkReply(interaction, session, userId);
    }
  },
};

/**
 * Whether the session has started: marked started by the cron, or past its start time. The cron
 * runs once a minute (and not at all under plain `pnpm dev`), so the buttons don't wait for it.
 */
function hasStarted(session: Session, now = Math.floor(Date.now() / 1000)): boolean {
  return session.status === "started" || (session.status === "scheduled" && session.startAt !== null && session.startAt <= now);
}

/** Edits the announcement the button is on to show the session as it is now. */
async function redraw(session: Session): Promise<APIInteractionResponse> {
  return { type: InteractionResponseType.UpdateMessage, data: announcementMessage(session, await participants(session.id)) };
}

/** A private reply with the user's own link to the session. */
async function linkReply(interaction: APIMessageComponentInteraction, session: Session, userId: string): Promise<APIInteractionResponse> {
  const [preferences, button] = await Promise.all([userPreferences(userId), seedBibleLinksEnabled(interaction.guild_id)]);
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: personalLinkMessage(session, preferences, { locale: interaction.locale, button }),
  };
}
