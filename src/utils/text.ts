/** Shortens text to `max` characters, ending with "…" if it was cut. Discord caps most labels at 100. */
export const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Stops text from being read as Discord formatting, for Bible text and titles people type:
 *   - "*", "_", "~", "`", "|": bold, italics, strikethrough, code, spoilers
 *   - "[" and "]": masked links, where "[Open Seed Bible](https://evil.example)" would show a
 *     harmless-looking clickable link in a message from the bot
 *   - "<" and ">": mentions and timestamps ("<@123>", "<t:0>")
 *   - "#", ">" or "-" starting a line: a heading, a quote or a list item (lines of poetry)
 */
export function escapeMarkdown(text: string): string {
  // A ">" starting a line is already escaped by the first replace.
  return text.replace(/[\\*_~`|<>[\]]/g, "\\$&").replace(/^([#-])/gm, "\\$1");
}
