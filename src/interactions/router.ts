import {
  ApplicationCommandType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { UserFacingError } from "../utils/errors.js";
import { commands } from "./commands/index.js";
import { components } from "./components/index.js";
import { parseCustomId } from "./components/custom-id.js";

// Finds the command or component an interaction is for and returns its response. The caller
// (server/app.ts) has already checked Discord's signature, sends the response, and then runs any
// deferred work (see deferred.ts).

const errorResponse = (content: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
});

/**
 * Runs a handler, turning a thrown error into a private error reply. A UserFacingError's message
 * is shown as is; anything else gets a generic message and is logged.
 */
async function run(
  label: string,
  handler: () => APIInteractionResponse | Promise<APIInteractionResponse>,
): Promise<APIInteractionResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof UserFacingError) return errorResponse(error.message);
    console.error(`[interactions] Error running ${label}:`, error);
    return errorResponse("Something went wrong. Please try again.");
  }
}

/** The response to send Discord, or null for an interaction type this app doesn't handle. */
export async function handleInteraction(interaction: APIInteraction): Promise<APIInteractionResponse | null> {
  // Discord's endpoint check
  if (interaction.type === InteractionType.Ping) return { type: InteractionResponseType.Pong };

  // Slash commands
  if (
    interaction.type === InteractionType.ApplicationCommand &&
    interaction.data.type === ApplicationCommandType.ChatInput
  ) {
    const { name } = interaction.data;
    const command = commands.get(name);
    if (!command) {
      console.warn(`[interactions] Unknown command: ${name}`);
      return errorResponse("Unknown command.");
    }
    // Narrowing on interaction.data.type doesn't narrow the parent object, hence the cast.
    return run(`/${name}`, () => command.execute(interaction as APIChatInputApplicationCommandInteraction));
  }

  // Suggestions while the user types an option marked `autocomplete: true`
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    const { name } = interaction.data;
    const autocomplete = commands.get(name)?.autocomplete;
    let choices: Awaited<ReturnType<NonNullable<typeof autocomplete>>> = [];
    try {
      if (autocomplete) choices = await autocomplete(interaction as APIApplicationCommandAutocompleteInteraction);
      else console.warn(`[interactions] No autocomplete for command: ${name}`);
    } catch (error) {
      // Autocomplete can't show an error message, so offer no suggestions instead.
      console.error(`[interactions] Error running autocomplete for /${name}:`, error);
    }
    return { type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices } };
  }

  // Buttons and select menus, routed by the id at the start of their custom_id
  if (interaction.type === InteractionType.MessageComponent) {
    const { id, args } = parseCustomId(interaction.data.custom_id);
    const component = components.get(id);
    if (!component) {
      console.warn(`[interactions] Unknown component: ${interaction.data.custom_id}`);
      return errorResponse("This button or menu no longer works.");
    }
    return run(`component "${id}"`, () => component.execute(interaction, args));
  }

  return null;
}
