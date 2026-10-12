import { describe, expect, it, vi } from "vitest";
import { ButtonStyle, ComponentType, MessageFlags } from "discord-api-types/v10";
import { FreeUseBibleApi } from "free-use-bible-api";
import { bibleApi } from "../../src/bible/api.js";
import { findPassages } from "../../src/bible/references.js";
import { passageReplies, type PassageReply } from "../../src/inline/passages.js";
import { mockFetch } from "../helpers/bible-api.js";

const JOHN_3_16 =
  "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.";

const replies = (text: string, buttons = true) => passageReplies(findPassages(text), { buttons });

/** The text in a reply's box. */
const textOf = (reply: PassageReply) => reply.components[0].components.find((c) => c.type === ComponentType.TextDisplay)!.content;

/** The link button's URL in a reply's box, if it has one. */
const buttonUrlOf = (reply: PassageReply) => {
  const row = reply.components[0].components.find((c) => c.type === ComponentType.ActionRow);
  const button = row?.components[0];
  return button && "url" in button ? button.url : undefined;
};

describe("passageReplies", () => {
  it("is a components message: a box with the passage and an Open in Seed Bible button", async () => {
    mockFetch();
    expect(await replies("John 3:16")).toEqual([
      {
        flags: MessageFlags.IsComponentsV2,
        components: [
          {
            type: ComponentType.Container,
            components: [
              { type: ComponentType.TextDisplay, content: `### John 3:16 (AAB)\n${JOHN_3_16}` },
              {
                type: ComponentType.ActionRow,
                components: [
                  {
                    type: ComponentType.Button,
                    style: ButtonStyle.Link,
                    label: "Open in Seed Bible →",
                    url: "https://seedbible.org/john/3?verse=16&source=discord_bot",
                  },
                ],
              },
            ],
          },
        ],
        allowed_mentions: { parse: [] },
      },
    ]);
  });

  it("gives each reference its own reply: gen 1 1 and exo 2 3", async () => {
    mockFetch();
    const result = await replies("telll me what happen in gen 1 1 and exo 2 3");
    expect(result.map(textOf)).toEqual(["### Genesis 1:1 (AAB)\nGEN 1:1 text.", "### Exodus 2:3 (AAB)\nEXO 2:3 text."]);
    expect(result.map(buttonUrlOf)).toEqual([
      "https://seedbible.org/genesis/1?verse=1&source=discord_bot",
      "https://seedbible.org/exodus/2?verse=3&source=discord_bot",
    ]);
  });

  describe("the examples asked for", () => {
    it("genesis → Genesis 1, linking to the chapter", async () => {
      mockFetch();
      const [reply] = await replies("genesis");
      expect(textOf(reply!)).toMatch(/^### Genesis 1 \(AAB\)\n\*\*1\*\* GEN 1:1 text\.\n\*\*2\*\* GEN 1:2 text\./);
      expect(buttonUrlOf(reply!)).toBe("https://seedbible.org/genesis/1?source=discord_bot");
    });

    it("genesis 2 → Genesis 2", async () => {
      mockFetch();
      const [reply] = await replies("genesis 2");
      expect(textOf(reply!)).toMatch(/^### Genesis 2 \(AAB\)\n/);
      expect(buttonUrlOf(reply!)).toBe("https://seedbible.org/genesis/2?source=discord_bot");
    });

    it("genesis 2 3-4 → Genesis 2:3-4, linking to those verses (with no translation in the link)", async () => {
      mockFetch();
      const [reply] = await replies("genesis 2 3-4");
      expect(textOf(reply!)).toBe("### Genesis 2:3-4 (AAB)\n**3** GEN 2:3 text.\n**4** GEN 2:4 text.");
      expect(buttonUrlOf(reply!)).toBe("https://seedbible.org/genesis/2?verse=3-4&source=discord_bot");
    });
  });

  it("shows non-contiguous verses and links to all of them", async () => {
    mockFetch();
    const [reply] = await replies("John 1:1-3, 5");
    expect(textOf(reply!)).toBe("### John 1:1-3, 5 (AAB)\n**1** JHN 1:1 text.\n**2** JHN 1:2 text.\n**3** JHN 1:3 text.\n**5** JHN 1:5 text.");
    expect(buttonUrlOf(reply!)).toBe("https://seedbible.org/john/1?verse=1-3%2C5&source=discord_bot");
  });

  it("labels each chapter's first verse in a passage over several chapters, and links to the first chapter", async () => {
    mockFetch();
    const [reply] = await replies("John 3:35-4:2");
    expect(textOf(reply!)).toBe("### John 3:35-4:2 (AAB)\n**3:35** JHN 3:35 text.\n**36** JHN 3:36 text.\n**4:1** JHN 4:1 text.\n**2** JHN 4:2 text.");
    expect(buttonUrlOf(reply!)).toBe("https://seedbible.org/john/3?source=discord_bot");
  });

  it("names a psalm in the singular and opens it with its title", async () => {
    mockFetch();
    const [reply] = await replies("Ps 23");
    expect(textOf(reply!)).toMatch(/^### Psalm 23 \(AAB\)\n\*A Psalm of David\.\*\n\*\*1\*\* The LORD is my shepherd;\nI shall not want\./);
  });

  it("uses Seed Bible's name for the book in the link", async () => {
    mockFetch();
    const [reply] = await replies("1 Cor 13:4");
    expect(buttonUrlOf(reply!)).toBe("https://seedbible.org/1-corinthians/13?verse=4&source=discord_bot");
  });

  describe("Discord's limit", () => {
    it("cuts a long chapter short so the message stays within 4,000 characters", async () => {
      mockFetch();
      const text = textOf((await replies("Psalm 119"))[0]!);
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(text.endsWith("…")).toBe(true);
    });

    it("gives every reply the whole limit, since each is its own message", async () => {
      mockFetch();
      const result = await replies("Psalm 119 and Psalm 119:1-176");
      expect(result).toHaveLength(2);
      for (const reply of result) expect(textOf(reply).length).toBeGreaterThan(3800);
    });

    it("cuts between lines, never through a bold verse number or an escape", async () => {
      mockFetch();
      const lines = textOf((await replies("Psalm 119"))[0]!).split("\n");
      // After the heading and the psalm's title, every line is a whole verse; the last ends in "…".
      expect(lines.at(-1)).toMatch(/^\*\*\d+\*\* .*\(\d+\)…$/);
      expect(lines.slice(2).every((line) => /^\*\*\d+\*\* .*\(\d+\)…?$/.test(line))).toBe(true);
    });

    it("cuts one very long verse between words", async () => {
      mockFetch();
      const chapter = await bibleApi.getSimpleTranslationBookChapter("AAB", "EST", 8);
      vi.spyOn(bibleApi, "getSimpleTranslationBookChapter").mockResolvedValue({
        ...chapter,
        chapter: { ...chapter.chapter, content: [{ type: "verse", number: 9, text: "word ".repeat(1000).trim(), footnotes: [] }] },
      });
      const text = textOf((await replies("Esther 8:9"))[0]!);
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(text.endsWith(" word…")).toBe(true);
    });

    it("loads at most 3 chapters of a long range", async () => {
      const { spy } = mockFetch();
      // A fresh client, so chapters cached by other tests are counted too.
      const [reply] = await passageReplies(findPassages("Genesis 1-50"), { buttons: true }, new FreeUseBibleApi());
      expect(textOf(reply!)).toMatch(/^### Genesis 1-3 \(AAB\)/);
      expect(spy.mock.calls.filter(([url]) => String(url).includes("/GEN/"))).toHaveLength(3);
    });

    it("titles a range cut short at 3 chapters by the whole chapters it shows", async () => {
      mockFetch();
      const [reply] = await replies("Gen 1:5-10:3");
      expect(textOf(reply!).split("\n")[0]).toBe("### Genesis 1:5-3 (AAB)");
    });
  });

  it("loads the chapters of every passage at the same time", async () => {
    mockFetch();
    let loading = 0;
    let mostAtOnce = 0;
    const load = bibleApi.getSimpleTranslationBookChapter.bind(bibleApi);
    vi.spyOn(bibleApi, "getSimpleTranslationBookChapter").mockImplementation(async (...args) => {
      mostAtOnce = Math.max(mostAtOnce, ++loading);
      await new Promise((resolve) => setTimeout(resolve, 5));
      loading--;
      return load(...args);
    });
    await replies("John 3:35-4:2 and Gen 1:1 and Exo 2:3");
    expect(mostAtOnce).toBe(4);
  });

  it("writes the link out instead of a button where link buttons are off", async () => {
    mockFetch();
    const [reply] = await replies("genesis 2 3-4", false);
    expect(reply!.components[0].components).toEqual([
      {
        type: ComponentType.TextDisplay,
        content: "### Genesis 2:3-4 (AAB)\n**3** GEN 2:3 text.\n**4** GEN 2:4 text.\n\nOpen in Seed Bible: <https://seedbible.org/genesis/2?verse=3-4&source=discord_bot>",
      },
    ]);
  });

  it("only names the verses that exist when a range runs past the chapter's end", async () => {
    mockFetch();
    // The parser checks verses against its own verse counts, so build the passage by hand.
    const [reply] = await passageReplies([{ book: "JHN", segments: [{ startChapter: 3, startVerse: 35, endChapter: 3, endVerse: 40 }] }], { buttons: true });
    expect(textOf(reply!).split("\n")[0]).toBe("### John 3:35-36 (AAB)");
  });

  it("skips passages that don't exist, so they get no reply", async () => {
    mockFetch();
    expect(await passageReplies([{ book: "JHN", segments: [{ startChapter: 22, endChapter: 22 }] }], { buttons: true })).toEqual([]);
  });

  it("skips a passage the Bible API fails to load", async () => {
    mockFetch();
    vi.spyOn(bibleApi, "getSimpleTranslationBookChapter").mockRejectedValue(new Error("network"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await replies("Luke 1:1")).toEqual([]);
  });

  it("stops Bible text from being read as Discord formatting", async () => {
    mockFetch();
    const chapter = await bibleApi.getSimpleTranslationBookChapter("AAB", "MAT", 1);
    vi.spyOn(bibleApi, "getSimpleTranslationBookChapter").mockResolvedValue({
      ...chapter,
      chapter: { ...chapter.chapter, content: [{ type: "verse", number: 1, text: "*not italic* and\n# not a heading", footnotes: [] }] },
    });
    expect((await replies("Matt 1:1")).map(textOf)).toEqual(["### Matthew 1:1 (AAB)\n\\*not italic\\* and\n\\# not a heading"]);
  });
});
