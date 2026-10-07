import type {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandOptionChoice,
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponse,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export interface Command {
  /** The command definition sent to Discord by `pnpm deploy-commands`. */
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Returns the response Discord shows to the user. Must resolve within 3 seconds. */
  execute: (
    interaction: APIChatInputApplicationCommandInteraction,
  ) => APIInteractionResponse | Promise<APIInteractionResponse>;
  /**
   * Suggests values while the user types an option marked `autocomplete: true`. The option being
   * typed has `focused: true`. Return at most 25 choices. Must also resolve within 3 seconds.
   */
  autocomplete?: (
    interaction: APIApplicationCommandAutocompleteInteraction,
  ) => APIApplicationCommandOptionChoice[] | Promise<APIApplicationCommandOptionChoice[]>;
}
