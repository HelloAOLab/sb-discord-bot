import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ChannelType,
  ComponentType,
  InteractionType,
  MessageType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIApplicationCommandInteractionDataBasicOption,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionGuildMember,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";

const TEST_USER = {
  id: "100000000000000001",
  username: "tester",
  global_name: "Tester",
  discriminator: "0",
  avatar: null,
};

/**
 * Builds a slash-command interaction payload like the one Discord POSTs to /interactions.
 * Only the fields our code reads are realistic; pass `overrides` to change any of them.
 */
export function chatInputInteraction(
  name: string,
  options: APIApplicationCommandInteractionDataBasicOption[] = [],
  overrides: Partial<APIChatInputApplicationCommandInteraction> = {},
): APIChatInputApplicationCommandInteraction {
  return {
    id: "200000000000000001",
    application_id: process.env.DISCORD_CLIENT_ID!,
    type: InteractionType.ApplicationCommand,
    token: "test-interaction-token",
    version: 1,
    guild_id: "300000000000000001",
    channel_id: "400000000000000001",
    member: { user: TEST_USER, roles: [], joined_at: "2026-01-01T00:00:00.000Z", permissions: "0", deaf: false, mute: false, flags: 0 },
    locale: "en-US",
    app_permissions: "0",
    entitlements: [],
    authorizing_integration_owners: {},
    attachment_size_limit: 8 * 1024 * 1024,
    data: {
      id: "500000000000000001",
      name,
      type: ApplicationCommandType.ChatInput,
      options,
    },
    ...overrides,
  } as APIChatInputApplicationCommandInteraction;
}

/**
 * Builds a button-click payload like the one Discord POSTs when a user clicks a component.
 * `customId` is the clicked component's custom_id, e.g. customId("ping-again", 1).
 */
export function buttonInteraction(
  customId: string,
  overrides: Partial<APIMessageComponentInteraction> = {},
): APIMessageComponentInteraction {
  const base = chatInputInteraction("unused");
  return {
    ...base,
    type: InteractionType.MessageComponent,
    channel: { id: base.channel_id!, type: ChannelType.GuildText },
    message: {
      id: "600000000000000001",
      channel_id: base.channel_id!,
      author: { ...TEST_USER, id: base.application_id, bot: true },
      content: "",
      timestamp: "2026-01-01T00:00:00.000Z",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: MessageType.Default,
    },
    data: { custom_id: customId, component_type: ComponentType.Button },
    ...overrides,
  } as APIMessageComponentInteraction;
}

/**
 * Builds the payload Discord POSTs when a user picks from a string select menu.
 * `customId` is the menu's custom_id; `values` are the chosen options' values.
 */
export function selectInteraction(
  customId: string,
  values: string[],
  overrides: Partial<APIMessageComponentInteraction> = {},
): APIMessageComponentInteraction {
  const click = buttonInteraction(customId);
  return {
    ...click,
    data: { custom_id: customId, component_type: ComponentType.StringSelect, values },
    ...overrides,
  } as APIMessageComponentInteraction;
}

/**
 * Builds an autocomplete payload like the one Discord POSTs while a user types an option marked
 * `autocomplete: true`. Mark the option being typed with opt.focused().
 */
export function autocompleteInteraction(
  name: string,
  options: APIApplicationCommandInteractionDataBasicOption[] = [],
  overrides: Partial<APIApplicationCommandAutocompleteInteraction> = {},
): APIApplicationCommandAutocompleteInteraction {
  return {
    ...chatInputInteraction(name, options),
    type: InteractionType.ApplicationCommandAutocomplete,
    ...overrides,
  } as APIApplicationCommandAutocompleteInteraction;
}

/**
 * Returns a copy of a server interaction whose member has exactly these permissions, e.g.
 * withPermissions(chatInputInteraction("x"), PermissionFlagsBits.ManageGuild). By default the
 * helpers' member has none ("0").
 */
export function withPermissions<T extends { member?: APIInteractionGuildMember }>(interaction: T, permissions: bigint): T {
  return { ...interaction, member: { ...interaction.member!, permissions: permissions.toString() } };
}

/** Option builders matching what Discord sends for each option type. */
export const opt = {
  string: (name: string, value: string) => ({ name, type: ApplicationCommandOptionType.String, value }) as const,
  /**
   * The option the user is typing in, as sent with an autocomplete interaction. Discord sends the
   * partly typed text as a string even for integer and number options.
   */
  focused: (
    name: string,
    value: string,
    type: ApplicationCommandOptionType.String | ApplicationCommandOptionType.Integer | ApplicationCommandOptionType.Number = ApplicationCommandOptionType.String,
  ) => ({ name, type, value, focused: true }) as unknown as APIApplicationCommandInteractionDataBasicOption,
  integer: (name: string, value: number) => ({ name, type: ApplicationCommandOptionType.Integer, value }) as const,
  number: (name: string, value: number) => ({ name, type: ApplicationCommandOptionType.Number, value }) as const,
  boolean: (name: string, value: boolean) => ({ name, type: ApplicationCommandOptionType.Boolean, value }) as const,
};
