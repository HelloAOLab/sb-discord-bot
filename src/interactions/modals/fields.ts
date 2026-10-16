import { ComponentType, type APIModalSubmitInteraction, type ModalSubmitComponent } from "discord-api-types/v10";

// Reading what someone entered in a submitted modal (pop-up form). Discord sends back each field
// inside the Label (or, in older modals, the action row) it was shown in, keyed by its custom_id.

export type ModalFields = Map<string, ModalSubmitComponent>;

export function modalFields(interaction: APIModalSubmitInteraction): ModalFields {
  const fields: ModalFields = new Map();
  for (const item of interaction.data.components) {
    if (item.type === ComponentType.Label) fields.set(item.component.custom_id, item.component);
    else if (item.type === ComponentType.ActionRow) for (const input of item.components) fields.set(input.custom_id, input);
  }
  return fields;
}

/** A text input's value, trimmed; undefined when it's missing or blank. */
export function textField(fields: ModalFields, id: string): string | undefined {
  const field = fields.get(id);
  const value = field?.type === ComponentType.TextInput ? field.value.trim() : "";
  return value === "" ? undefined : value;
}

/** The option chosen in a radio group or a single-choice select menu; undefined when none is. */
export function choiceField(fields: ModalFields, id: string): string | undefined {
  const field = fields.get(id);
  if (field?.type === ComponentType.RadioGroup) return field.value ?? undefined;
  if (field?.type === ComponentType.StringSelect) return field.values[0];
  return undefined;
}
