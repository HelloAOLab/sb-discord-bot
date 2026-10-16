import {
  deleteOldSessions,
  deleteStaleDrafts,
  dueReminders,
  dueStarts,
  markReminderSent,
  markStarted,
  participants,
  type Session,
} from "../storage/sessions.js";
import { createMessage } from "../utils/discord.js";
import { reminderMessage, startMessage } from "./messages.js";

// Sends scheduled sessions' reminders and start messages. The Worker has no long-running process,
// so the cron (wrangler.jsonc, every minute) calls runDueSessions(), which finds what's due in the
// database. A session therefore starts within about a minute of its time.
//
// Each session is marked as reminded or started *before* its message is posted, so a message is
// never posted twice, even if two runs overlap. A message Discord rejects (the bot was removed, or
// can't post in the channel) is logged and not retried.

/** A time picker left open this long is deleted with its draft session. */
const DRAFT_LIFETIME_SECONDS = 24 * 60 * 60;
/** Sessions that started (or were cancelled) this long ago are deleted, with who joined them. */
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** `now` is Unix seconds. Without a bot token, nothing can be posted, so due sessions are only logged. */
export async function runDueSessions(token: string | undefined, now = Math.floor(Date.now() / 1000)): Promise<void> {
  await deleteStaleDrafts(now - DRAFT_LIFETIME_SECONDS);
  await deleteOldSessions(now - SESSION_LIFETIME_SECONDS);

  for (const session of await dueReminders(now)) {
    if (!(await markReminderSent(session.id))) continue;
    await post(token, session, "reminder", reminderMessage(session, await participants(session.id)));
  }

  for (const session of await dueStarts(now)) {
    if (!(await markStarted(session.id))) continue;
    await post(token, session, "start message", startMessage({ ...session, status: "started" }, await participants(session.id)));
  }
}

async function post(token: string | undefined, session: Session, what: string, body: Parameters<typeof createMessage>[2]): Promise<void> {
  if (!token) {
    console.error(`[sessions] DISCORD_TOKEN is missing, so session ${session.id}'s ${what} wasn't posted. Set it with \`pnpm wrangler secret put DISCORD_TOKEN\`.`);
    return;
  }
  try {
    await createMessage(token, session.channelId, body);
    console.log(`[sessions] Posted the ${what} for session ${session.id} in guild ${session.guildId}`);
  } catch (error) {
    console.error(`[sessions] Couldn't post the ${what} for session ${session.id}:`, error);
  }
}
