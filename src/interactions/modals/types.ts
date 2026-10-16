import type { APIInteractionResponse, APIModalSubmitInteraction } from "discord-api-types/v10";

export interface Modal {
  /** The first part of the modal's custom_id (before any ":"). The router uses it to find this handler. */
  id: string;
  /**
   * Handles the submitted form. `args` are the custom_id parts after the id. Read the fields with
   * modalFields(). Must resolve within 3 seconds, like commands.
   */
  execute: (
    interaction: APIModalSubmitInteraction,
    args: string[],
  ) => APIInteractionResponse | Promise<APIInteractionResponse>;
}
