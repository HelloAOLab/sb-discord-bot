/** Shortens text to `max` characters, ending with "…" if it was cut. Discord caps most labels at 100. */
export const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
