import { describe, expect, it } from "vitest";
import { describePassage, findPassages, MAX_PASSAGES, type PassageSegment } from "../../src/bible/references.js";

/** A segment within one chapter: verses `start`-`end`, or the whole chapter without them. */
const verses = (chapter: number, start?: number, end = start): PassageSegment => ({
  startChapter: chapter,
  startVerse: start,
  endChapter: chapter,
  endVerse: end,
});

describe("findPassages", () => {
  describe("the forms asked for", () => {
    it("reads a book on its own as its first chapter: genesis", () => {
      expect(findPassages("genesis")).toEqual([{ book: "GEN", segments: [verses(1)] }]);
      expect(findPassages("I'm reading Genesis today")).toEqual([{ book: "GEN", segments: [verses(1)] }]);
    });

    it("reads a chapter: genesis 2", () => {
      expect(findPassages("genesis 2")).toEqual([{ book: "GEN", segments: [verses(2)] }]);
    });

    it("reads chapter and verses without a colon: genesis 2 3-4", () => {
      expect(findPassages("genesis 2 3-4")).toEqual([{ book: "GEN", segments: [verses(2, 3, 4)] }]);
    });

    it("reads the usual forms: John 3:16, Romans 8:28-30, Ps 23", () => {
      expect(findPassages("John 3:16")).toEqual([{ book: "JHN", segments: [verses(3, 16)] }]);
      expect(findPassages("Romans 8:28-30")).toEqual([{ book: "ROM", segments: [verses(8, 28, 30)] }]);
      expect(findPassages("Ps 23")).toEqual([{ book: "PSA", segments: [verses(23)] }]);
    });

    it("keeps non-contiguous verses together: John 1:1-3, 5", () => {
      expect(findPassages("John 1:1-3, 5")).toEqual([{ book: "JHN", segments: [verses(1, 1, 3), verses(1, 5)] }]);
    });
  });

  describe("other ways of writing a reference", () => {
    it.each([
      ["1 Cor 13:4-7", "1CO"],
      ["first john 4:8", "1JN"],
      ["Rev. 22:21!", "REV"],
      ["Song of Songs 2:4", "SNG"],
      ["Jn 3.16", "JHN"],
    ])("%s", (text, book) => {
      expect(findPassages(text)).toEqual([expect.objectContaining({ book })]);
    });

    it("joins a continuation in another chapter to the same passage: Jn 3:16; 4:2", () => {
      expect(findPassages("Jn 3:16; 4:2")).toEqual([{ book: "JHN", segments: [verses(3, 16), verses(4, 2)] }]);
    });

    it("reads chapter ranges and ranges across chapters", () => {
      expect(findPassages("Genesis 1-3")).toEqual([{ book: "GEN", segments: [{ startChapter: 1, startVerse: undefined, endChapter: 3, endVerse: undefined }] }]);
      expect(findPassages("John 3:16-4:2")).toEqual([{ book: "JHN", segments: [{ startChapter: 3, startVerse: 16, endChapter: 4, endVerse: 2 }] }]);
    });

    it("cuts a range into the next book at the end of the first book", () => {
      expect(findPassages("Gen 50-Exod 2")).toEqual([{ book: "GEN", segments: [{ startChapter: 50, startVerse: undefined, endChapter: Infinity, endVerse: undefined }] }]);
    });
  });

  describe("several references in one message", () => {
    it("returns one passage per book named, in the order written", () => {
      expect(findPassages("John 3:16 and Rom 8:28").map((p) => p.book)).toEqual(["JHN", "ROM"]);
      expect(findPassages("John 3:16, John 4:2")).toHaveLength(2);
    });

    it(`takes at most ${MAX_PASSAGES}, so a list can't flood the channel`, () => {
      expect(findPassages("Gen 1, Exod 2, Lev 3, Num 4, Deut 5")).toHaveLength(MAX_PASSAGES);
    });

    it("still adds verses that continue the last passage it took", () => {
      expect(findPassages("Gen 1, Exod 2, Lev 3:1, 5, Num 4")[2]).toEqual({ book: "LEV", segments: [verses(3, 1), verses(3, 5)] });
    });
  });

  describe("text that isn't a reference", () => {
    it.each([
      ["an abbreviation on its own (would make every 'is' Isaiah 1)", "This is great"],
      ["'so' (Song of Songs)", "so what"],
      ["'Ex' (Exodus)", "Ex machina"],
      ["a chapter that doesn't exist", "Genesis 51"],
      ["a verse that doesn't exist", "John 3:99"],
      ["ordinary chat", "hey everyone, how was church on sunday?"],
    ])("%s: %s", (_, text) => {
      expect(findPassages(text)).toEqual([]);
    });

    it.each([
      ["it is 5 pm", "Isaiah"],
      ["I am 2 hours late", "Amos"],
      ["so 3 of us went", "Song of Songs"],
      ["my ex 2 years ago", "Exodus"],
      ["la 3 is far", "Lamentations"],
      ["pro 4 life", "Proverbs"],
      ["kings 3 games", "1 Kings (a guess at which one)"],
    ])("an everyday word before a number: %s (not %s)", (text) => {
      expect(findPassages(text)).toEqual([]);
    });

    it.each(["I got a job", "Mark is coming later", "those numbers look off", "John said hi", "what a revelation", "the Acts we saw"])(
      "a book name on its own that's also a common word or name: %s",
      (text) => {
        expect(findPassages(text)).toEqual([]);
      },
    );

    it("doesn't turn the numbers after a skipped word into a reference: it is 5, 6", () => {
      expect(findPassages("it is 5, 6")).toEqual([]);
    });

    it("still reads those books with a chapter, and the usual abbreviations", () => {
      expect(findPassages("Job 3").map((p) => p.book)).toEqual(["JOB"]);
      expect(findPassages("mark 2:17").map((p) => p.book)).toEqual(["MRK"]);
      expect(findPassages("Isa 5").map((p) => p.book)).toEqual(["ISA"]);
      expect(findPassages("Ex. 3:14").map((p) => p.book)).toEqual(["EXO"]); // with a dot it is an abbreviation
      expect(findPassages("Exod 3:14").map((p) => p.book)).toEqual(["EXO"]);
      expect(findPassages("1 Kings 3").map((p) => p.book)).toEqual(["1KI"]);
      expect(findPassages("Col 3:16").map((p) => p.book)).toEqual(["COL"]);
    });

    it("keeps a full book name next to an abbreviation it ignores: genesis is great", () => {
      expect(findPassages("genesis is great")).toEqual([{ book: "GEN", segments: [verses(1)] }]);
    });

    it.each([
      ["inline code", "`John 3:16`"],
      ["a code block", "```\nJohn 3:16\n```"],
      ["a link", "https://example.com/John%203:16"],
      ["a link in angle brackets", "<https://example.com/John 3:16>"],
    ])("ignores %s", (_, text) => {
      expect(findPassages(text)).toEqual([]);
    });
  });
});

describe("describePassage", () => {
  const describe_ = (segments: PassageSegment[], name = "John") => describePassage({ book: "JHN", segments }, name);

  it("writes a reference the way people do", () => {
    expect(describe_([verses(3, 16)])).toBe("John 3:16");
    expect(describe_([verses(8, 28, 30)], "Romans")).toBe("Romans 8:28-30");
    expect(describe_([verses(1, 1, 3), verses(1, 5)])).toBe("John 1:1-3, 5");
    expect(describe_([verses(3, 16), verses(4, 2)])).toBe("John 3:16; 4:2");
    expect(describe_([verses(23)], "Psalm")).toBe("Psalm 23");
    expect(describe_([{ startChapter: 1, endChapter: 3 }], "Genesis")).toBe("Genesis 1-3");
    expect(describe_([{ startChapter: 3, startVerse: 16, endChapter: 4, endVerse: 2 }])).toBe("John 3:16-4:2");
  });
});
