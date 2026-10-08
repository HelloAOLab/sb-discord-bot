// Discord sends back a component's custom_id when it's clicked. We encode it as
// "<component id>:<arg>:<arg>..." so the router can find the handler by id and pass it the
// args (e.g. "open-picker:book:BSB"). Discord caps custom_id at 100 characters.

const SEPARATOR = ":";
const MAX_LENGTH = 100;

/** Builds a custom_id. Throws if an arg contains ":" or the result is too long for Discord. */
export function customId(id: string, ...args: (string | number)[]): string {
  const parts = [id, ...args.map(String)];
  if (parts.some((part) => part.includes(SEPARATOR))) {
    throw new Error(`custom_id parts must not contain "${SEPARATOR}": ${parts.join(", ")}`);
  }
  const value = parts.join(SEPARATOR);
  if (value.length > MAX_LENGTH) {
    throw new Error(`custom_id is ${value.length} characters; Discord allows ${MAX_LENGTH}: ${value}`);
  }
  return value;
}

/** Splits a custom_id back into the component id and its args. */
export function parseCustomId(value: string): { id: string; args: string[] } {
  const [id = "", ...args] = value.split(SEPARATOR);
  return { id, args };
}
