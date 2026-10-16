import type { APIInteraction } from "discord-api-types/v10";

/** The ID of the user who triggered an interaction: `member.user` in a server, `user` in DMs. */
export function interactionUserId(interaction: Pick<APIInteraction, "member" | "user">): string {
  const id = interaction.member?.user.id ?? interaction.user?.id;
  if (!id) throw new Error("Interaction has no user.");
  return id;
}
