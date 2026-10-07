import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIInteractionResponseCallbackData,
  type APIMessageComponentInteraction,
  type APISelectMenuOption,
} from "discord-api-types/v10";
import type { ApiTranslationBook } from "free-use-bible-api";
import { bibleApi } from "../../bible/api.js";
import { findBook, loadBooks, type TranslationBooks } from "../../bible/books.js";
import { UserFacingError } from "../../utils/errors.js";
import { seedBibleUrl } from "../../seedbible/links.js";
import { describeUiLanguage, findUiLanguage } from "../../seedbible/ui-languages.js";
import { truncate } from "../../utils/text.js";
import { deferUpdate, sendFollowUp, type DeferredMessage } from "../deferred.js";
import { seedBibleLinksEnabled } from "../../storage/guild-settings.js";
import { openMessage, plainLink, resolveOpenLink } from "../open-link.js";
import { customId } from "./custom-id.js";
import { pagedOptions, pageFromValue } from "./pages.js";
import type { Component } from "./types.js";

// The private book picker that `/open` shows when no book is given, all on one message:
//
//   1. book: all the translation's books in Bible order, a page at a time ("Next →" at the end)
//   2. chapter: that book's chapters, also paged. Choosing one posts the usual public
//      "Open John 3 in Seed Bible" link. One-chapter books (Jude) post as soon as they're chosen.
//
// Each choice redraws the message, keeping the book menu so the user can change book.
// The app keeps no memory between clicks, so each menu's custom_id carries the state:
// "open-picker:<step>:<translation>:<lang>:<book>:<book page>:<chapter page>" (empty when unset).
// Keep this format and the step names stable once released, or menus on old messages stop working.

const ID = "open-picker";
const STEPS = ["book", "chapter"] as const;
type Step = (typeof STEPS)[number];

export interface PickerState {
  /** Exact Bible API translation ID; unset for the default. */
  translation?: string;
  /** seedbible.org interface language code. */
  lang?: string;
  /** USFM code of the chosen book. */
  book?: string;
  /** Page of the book menu being shown (0-based). */
  bookPage?: number;
  /** Page of the chapter menu being shown (0-based). */
  chapterPage?: number;
}

type ActionRow = APIActionRowComponent<APIComponentInMessageActionRow>;

/**
 * Draws the picker for the choices so far, from the chosen translation's books. With
 * `buttons: false` (the server turned Seed Bible link buttons off), the "Open Seed Bible" shortcut
 * is a link in the text instead of a button.
 */
export function pickerMessage(
  state: PickerState,
  books: TranslationBooks,
  { buttons = true }: { buttons?: boolean } = {},
): APIInteractionResponseCallbackData {
  const ordered = [...books.books].sort((a, b) => a.order - b.order);
  const book = state.book ? ordered.find((b) => b.id === state.book) : undefined;

  const bookMenu = pagedOptions(ordered, state.bookPage ?? 0, (b) => bookOption(b, books, b.id === book?.id));
  const chapterMenu = book
    ? pagedOptions(chaptersOf(book), state.chapterPage ?? 0, (n) => ({
        label: truncate(`${book.commonName} ${n}`, 100),
        value: String(n),
      }))
    : undefined;

  // Every menu carries the whole state, including the pages currently shown.
  const menuId = (step: Step) =>
    customId(ID, step, state.translation ?? "", state.lang ?? "", book?.id ?? "", bookMenu.page, chapterMenu?.page ?? 0);

  const rows: ActionRow[] = [selectRow(menuId("book"), placeholder("Book", bookMenu), bookMenu.options)];
  let prompt = "Choose a book.";
  if (bookMenu.pageCount > 1) prompt += " Pick **Next →** at the end of the list to see more books.";

  if (book && chapterMenu) {
    rows.push(selectRow(menuId("chapter"), placeholder("Chapter", chapterMenu), chapterMenu.options));
    prompt = `Choose a chapter of **${book.commonName}**.`;
    if (chapterMenu.pageCount > 1) prompt += " Pick **Next →** at the end of the list to see more chapters.";
  }

  // Lets the user skip the remaining steps, or open privately instead of posting a link.
  const skipLabel = book ? `Open ${book.commonName}` : "Open Seed Bible";
  const skipUrl = seedBibleUrl({
    book: book?.id,
    chapter: book?.firstChapterNumber,
    translation: state.translation,
    lang: state.lang,
  });
  if (buttons) {
    rows.push({
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: truncate(`${skipLabel} →`, 80), url: skipUrl }],
    });
  }

  const language = state.lang ? findUiLanguage(state.lang) : null;
  const settings = [
    state.translation ? `Translation: ${books.translation.shortName ?? books.translation.id}` : undefined,
    language ? `Seed Bible in ${describeUiLanguage(language)}` : undefined,
  ].filter(Boolean);

  const lines = [prompt];
  if (!buttons) lines.push(`-# Or open ${book ? book.commonName : "Seed Bible"} now: ${plainLink(skipUrl)}`);
  if (settings.length > 0) lines.push(`-# ${settings.join(" · ")}`);

  return { content: lines.join("\n"), components: rows, allowed_mentions: { parse: [] } };
}

export const openPicker: Component = {
  id: ID,

  execute(interaction, [step = "", translation = "", lang = "", book = "", bookPage = "", chapterPage = ""]) {
    const value = selectedValue(interaction);
    if (value === undefined || !(STEPS as readonly string[]).includes(step) || (step === "chapter" && book === "")) {
      throw new UserFacingError("This menu no longer works. Please run `/open` again.");
    }
    // Anyone can send any custom_id, so everything read from it is checked again below.
    const state: PickerState = {
      translation: translation || undefined,
      lang: findUiLanguage(lang)?.code,
      book: book || undefined,
      bookPage: toPage(bookPage),
      chapterPage: toPage(chapterPage),
    };
    const page = pageFromValue(value);
    // Checked on every click, so a change by a server admin applies to pickers already open.
    const buttons = seedBibleLinksEnabled(interaction.guild_id);

    // Loading book names can be slow on a cold cache, so update the message once they arrive.
    return deferUpdate(interaction, async () => {
      const books = await loadBooks(bibleApi, state.translation);

      if (step === "book") {
        if (page !== undefined) return pickerMessage({ ...state, bookPage: page }, books, { buttons });
        const chosen = findBook(books.books, value);
        if (chosen.numberOfChapters === 1) {
          return postLink(interaction, state, chosen.id, chosen.firstChapterNumber, buttons);
        }
        return pickerMessage({ ...state, book: chosen.id, chapterPage: 0 }, books, { buttons });
      }

      if (page !== undefined) return pickerMessage({ ...state, chapterPage: page }, books, { buttons });
      return postLink(interaction, state, book, Number(value), buttons);
    });
  },
};

/** Posts the public link for the chosen chapter (as a button, or as text), then closes the picker. */
async function postLink(
  interaction: APIMessageComponentInteraction,
  state: PickerState,
  book: string,
  chapter: number,
  button: boolean,
): Promise<DeferredMessage> {
  const link = await resolveOpenLink({ book, chapter, translation: state.translation });
  await sendFollowUp(interaction, openMessage({ ...link, target: { ...link.target, lang: state.lang } }, { button }));
  return { content: `Posted a link to **${link.description}** below.`, components: [], allowed_mentions: { parse: [] } };
}

function selectedValue(interaction: APIMessageComponentInteraction): string | undefined {
  return interaction.data.component_type === ComponentType.StringSelect ? interaction.data.values[0] : undefined;
}

/** A page number from a custom_id; anything garbled becomes the first page. */
function toPage(text: string): number {
  const page = Number.parseInt(text, 10);
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

function selectRow(customId: string, placeholder: string, options: APISelectMenuOption[]): ActionRow {
  return {
    type: ComponentType.ActionRow,
    components: [{ type: ComponentType.StringSelect, custom_id: customId, placeholder, options }],
  };
}

/** "Book" or "Book (page 2 of 3)". */
function placeholder(name: string, menu: { page: number; pageCount: number }): string {
  return menu.pageCount > 1 ? `${name} (page ${menu.page + 1} of ${menu.pageCount})` : name;
}

/** "Juan" with "John" underneath in a Spanish Bible. */
function bookOption(book: ApiTranslationBook, books: TranslationBooks, selected: boolean): APISelectMenuOption {
  const englishName = books.englishBooks.find((b) => b.id === book.id)?.commonName;
  return {
    label: truncate(book.commonName, 100),
    ...(englishName && englishName !== book.commonName ? { description: truncate(englishName, 100) } : {}),
    value: book.id,
    default: selected,
  };
}

function chaptersOf(book: ApiTranslationBook): number[] {
  const chapters: number[] = [];
  for (let n = book.firstChapterNumber; n <= book.lastChapterNumber; n++) chapters.push(n);
  return chapters;
}
