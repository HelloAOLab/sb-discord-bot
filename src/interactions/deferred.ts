import {
  InteractionResponseType,
  MessageFlags,
  RouteBases,
  Routes,
  type APIInteraction,
  type APIInteractionResponse,
  type RESTPatchAPIWebhookWithTokenMessageJSONBody,
  type RESTPostAPIWebhookWithTokenJSONBody,
} from "discord-api-types/v10";
import { UserFacingError } from "../utils/errors.js";

// Discord drops an interaction that isn't answered within 3 seconds. For slower work, a command
// answers right away with a "deferred" response (Discord shows "<app> is thinking…"), then edits
// that message once the work is done. server/app.ts starts the work (runDeferredWork) as it sends
// the response and keeps the Worker alive until it finishes (waitUntil). The edit must reach
// Discord after the response does, so an edit Discord doesn't recognize yet is retried once.

/** The message that replaces "is thinking…". */
export type DeferredMessage = RESTPatchAPIWebhookWithTokenMessageJSONBody;

type Interaction = Pick<APIInteraction, "application_id" | "token">;

/** How long to wait before retrying an edit Discord didn't recognize yet. */
const RETRY_DELAY_MS = 750;

const pendingWork = new WeakMap<APIInteractionResponse, () => Promise<void>>();

/**
 * Returns a deferred response and remembers `work` to run once it's sent. `work` returns the final
 * message. If it throws a UserFacingError, the "thinking" message is replaced with that error,
 * shown only to the user; any other error shows a generic private error and is logged.
 * With `ephemeral`, the "thinking" message and the final message are visible only to the user.
 */
export function deferReply(
  interaction: Interaction,
  work: () => Promise<DeferredMessage>,
  options: { ephemeral?: boolean } = {},
): APIInteractionResponse {
  const response: APIInteractionResponse = options.ephemeral
    ? { type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: MessageFlags.Ephemeral } }
    : { type: InteractionResponseType.DeferredChannelMessageWithSource };
  pendingWork.set(response, () => completeDeferredReply(interaction, work));
  return response;
}

/**
 * The component version of deferReply: for a click on a button or menu whose handler needs slow
 * work. Discord keeps the message as it is (no "thinking" message) until `work` returns the new
 * version of it. If `work` throws, the message is left alone and the error is sent privately.
 */
export function deferUpdate(interaction: Interaction, work: () => Promise<DeferredMessage>): APIInteractionResponse {
  const response: APIInteractionResponse = { type: InteractionResponseType.DeferredMessageUpdate };
  pendingWork.set(response, () => completeDeferredReply(interaction, work, { keepMessageOnError: true }));
  return response;
}

/** Runs the work attached to `response` by deferReply, if any. The router calls this after replying. */
export function runDeferredWork(response: APIInteractionResponse): Promise<void> | undefined {
  const work = pendingWork.get(response);
  pendingWork.delete(response);
  return work?.();
}

/**
 * Runs `work` and edits the deferred reply (or, for a component, the message it's on) with its
 * result. On error, sends a private message; unless `keepMessageOnError`, the deferred reply is
 * deleted first.
 */
export async function completeDeferredReply(
  interaction: Interaction,
  work: () => Promise<DeferredMessage>,
  options: { keepMessageOnError?: boolean } = {},
): Promise<void> {
  let message: DeferredMessage;
  try {
    message = await work();
  } catch (error) {
    if (!(error instanceof UserFacingError)) console.error("[interactions] Deferred work failed:", error);
    const content = error instanceof UserFacingError ? error.message : "Something went wrong. Please try again.";
    await sendPrivateError(interaction, content, { deleteOriginal: !options.keepMessageOnError });
    return;
  }

  try {
    await discordWebhookRequest(interaction, "PATCH", "@original", message);
  } catch (error) {
    console.error("[interactions] Couldn't edit deferred reply:", error);
  }
}

/**
 * Sends a new message in reply to an interaction that has already been answered. It's public
 * unless `body.flags` includes MessageFlags.Ephemeral. Throws if Discord rejects it.
 */
export function sendFollowUp(interaction: Interaction, body: RESTPostAPIWebhookWithTokenJSONBody): Promise<void> {
  return discordWebhookRequest(interaction, "POST", undefined, body);
}

/**
 * Errors should be private, but a deferred reply may be public, and a message can't be made
 * private after it's sent. So delete the "thinking" message (if asked) and send the error as a
 * private follow-up.
 */
async function sendPrivateError(
  interaction: Interaction,
  content: string,
  { deleteOriginal }: { deleteOriginal: boolean },
): Promise<void> {
  try {
    if (deleteOriginal) await discordWebhookRequest(interaction, "DELETE", "@original");
    await sendFollowUp(interaction, { content, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } });
  } catch (error) {
    console.error("[interactions] Couldn't send private error for deferred reply:", error);
  }
}

/**
 * Calls Discord's interaction webhook. These endpoints are authorized by the interaction token in
 * the URL (valid for 15 minutes), so no bot token is sent.
 */
async function discordWebhookRequest(
  interaction: Interaction,
  method: "PATCH" | "DELETE" | "POST",
  messageId?: "@original",
  body?: unknown,
): Promise<void> {
  const route = messageId
    ? Routes.webhookMessage(interaction.application_id, interaction.token, messageId)
    : Routes.webhook(interaction.application_id, interaction.token);

  const send = () =>
    fetch(`${RouteBases.api}${route}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let response = await send();
  // The work can finish before Discord has registered our deferred response (cached data makes it
  // nearly instant), and Discord then doesn't know the original message yet. Try once more.
  if (response.status === 404 && messageId) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await send();
  }
  if (!response.ok) {
    throw new Error(`Discord ${method} ${route.replace(interaction.token, "<token>")} failed: ${response.status} ${await response.text()}`);
  }
}
