import { Router, type Response } from "express";
import { verifyKeyMiddleware } from "discord-interactions";
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
import { config } from "../utils/config.js";
import { UserFacingError } from "../utils/errors.js";
import { commands } from "./commands/index.js";
import { components } from "./components/index.js";
import { parseCustomId } from "./components/custom-id.js";
import { runDeferredWork } from "./deferred.js";

const errorResponse = (content: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
});

/**
 * Runs a handler and sends its response, turning a thrown error into a private error reply.
 * A UserFacingError's message is shown as is; anything else gets a generic message and is logged.
 * If the handler deferred its reply (see deferred.ts), the deferred work starts after sending.
 */
async function respond(
  res: Response,
  label: string,
  handler: () => APIInteractionResponse | Promise<APIInteractionResponse>,
) {
  let response: APIInteractionResponse;
  try {
    response = await handler();
  } catch (error) {
    if (error instanceof UserFacingError) {
      res.json(errorResponse(error.message));
      return;
    }
    console.error(`[interactions] Error running ${label}:`, error);
    res.json(errorResponse("Something went wrong. Please try again."));
    return;
  }
  res.json(response);
  await runDeferredWork(response);
}

export function interactionsRouter(): Router {
  const router = Router();

  // verifyKeyMiddleware checks Discord's signature and answers PING requests itself.
  // It needs the raw body, so this router must be mounted before express.json().
  router.post("/", verifyKeyMiddleware(config.DISCORD_PUBLIC_KEY), async (req, res) => {
    const interaction = req.body as APIInteraction;

    // Slash commands
    if (
      interaction.type === InteractionType.ApplicationCommand &&
      interaction.data.type === ApplicationCommandType.ChatInput
    ) {
      const { name } = interaction.data;
      const command = commands.get(name);
      if (!command) {
        console.warn(`[interactions] Unknown command: ${name}`);
        res.json(errorResponse("Unknown command."));
        return;
      }
      // Narrowing on interaction.data.type doesn't narrow the parent object, hence the cast.
      await respond(res, `/${name}`, () =>
        command.execute(interaction as APIChatInputApplicationCommandInteraction),
      );
      return;
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
      res.json({ type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices } });
      return;
    }

    // Buttons and select menus, routed by the id at the start of their custom_id
    if (interaction.type === InteractionType.MessageComponent) {
      const { id, args } = parseCustomId(interaction.data.custom_id);
      const component = components.get(id);
      if (!component) {
        console.warn(`[interactions] Unknown component: ${interaction.data.custom_id}`);
        res.json(errorResponse("This button or menu no longer works."));
        return;
      }
      await respond(res, `component "${id}"`, () => component.execute(interaction, args));
      return;
    }

    res.status(400).json({ error: "Unsupported interaction type" });
  });

  return router;
}
