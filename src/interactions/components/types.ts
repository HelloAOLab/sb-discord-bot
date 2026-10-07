import type { APIInteractionResponse, APIMessageComponentInteraction } from "discord-api-types/v10";

export interface Component {
  /** The first part of the custom_id (before any ":"). The router uses it to find this handler. */
  id: string;
  /**
   * Handles a click or selection. `args` are the custom_id parts after the id.
   * Must resolve within 3 seconds, like commands.
   */
  execute: (
    interaction: APIMessageComponentInteraction,
    args: string[],
  ) => APIInteractionResponse | Promise<APIInteractionResponse>;
}
