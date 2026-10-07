import type { APISelectMenuOption } from "discord-api-types/v10";

// Discord select menus hold at most 25 options. For longer lists (66 books, 150 psalms), a menu
// shows one page at a time: "← Previous" as the first option and "Next →" as the last, so a page
// has 23–24 real items. Choosing one of those sends a value like "page:2", and the handler redraws
// the menu at that page.

const MAX_OPTIONS = 25;
const PAGE_VALUE = /^page:(\d+)$/;

/** Index of each page's first item. Every page but the last ends with "Next →"; every page but the first starts with "← Previous". */
function pageStarts(total: number): number[] {
  const starts = [0];
  let start = 0;
  for (let page = 0; ; page++) {
    const room = MAX_OPTIONS - (page > 0 ? 1 : 0); // without a "Next →"
    if (total - start <= room) return starts;
    start += room - 1; // leave a slot for "Next →"
    starts.push(start);
  }
}

export interface PagedOptions {
  options: APISelectMenuOption[];
  /** The page shown, after clamping a missing or out-of-range page to a valid one. */
  page: number;
  pageCount: number;
}

/**
 * The options for one page of `items`. `toOption` turns an item into its option; the page
 * options' descriptions name the first and last item of the page they lead to ("Daniel – Romans").
 */
export function pagedOptions<T>(items: T[], page: number, toOption: (item: T) => APISelectMenuOption): PagedOptions {
  const starts = pageStarts(items.length);
  const current = Number.isInteger(page) ? Math.min(Math.max(page, 0), starts.length - 1) : 0;
  const pageItems = (index: number) => items.slice(starts[index], starts[index + 1] ?? items.length);
  const span = (index: number) => {
    const shown = pageItems(index);
    return `${toOption(shown[0]!).label} – ${toOption(shown.at(-1)!).label}`.slice(0, 100);
  };

  const options = pageItems(current).map(toOption);
  if (current > 0) options.unshift({ label: "← Previous", description: span(current - 1), value: `page:${current - 1}` });
  if (current < starts.length - 1) options.push({ label: "Next →", description: span(current + 1), value: `page:${current + 1}` });

  return { options, page: current, pageCount: starts.length };
}

/** The page number if `value` is a "← Previous" / "Next →" choice, otherwise undefined. */
export function pageFromValue(value: string): number | undefined {
  const match = PAGE_VALUE.exec(value);
  return match ? Number(match[1]) : undefined;
}
