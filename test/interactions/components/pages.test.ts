import { describe, expect, it } from "vitest";
import { pagedOptions, pageFromValue } from "../../../src/interactions/components/pages.js";

const numbers = (count: number) => Array.from({ length: count }, (_, i) => i + 1);
const page = (count: number, index: number) =>
  pagedOptions(numbers(count), index, (n) => ({ label: `Item ${n}`, value: String(n) }));
const values = (count: number, index: number) => page(count, index).options.map((o) => o.value);

describe("pagedOptions", () => {
  it("shows up to 25 items on one page, with no page options", () => {
    expect(values(25, 0)).toEqual(numbers(25).map(String));
    expect(page(25, 0).pageCount).toBe(1);
  });

  it("ends every page but the last with 'Next →'", () => {
    expect(page(26, 0).options.at(-1)).toEqual({ label: "Next →", description: "Item 25 – Item 26", value: "page:1" });
    expect(values(26, 0)).toHaveLength(25);
  });

  it("starts every page but the first with '← Previous'", () => {
    expect(page(26, 1).options).toEqual([
      { label: "← Previous", description: "Item 1 – Item 24", value: "page:0" },
      { label: "Item 25", value: "25" },
      { label: "Item 26", value: "26" },
    ]);
  });

  it("splits the 66 books into three pages", () => {
    expect(page(66, 0).pageCount).toBe(3);
    expect(values(66, 0).slice(-2)).toEqual(["24", "page:1"]);
    expect(values(66, 1)).toEqual(["page:0", ...numbers(23).map((n) => String(n + 24)), "page:2"]);
    expect(values(66, 2)).toEqual(["page:1", ...numbers(19).map((n) => String(n + 47))]);
  });

  it("never shows more than 25 options and shows every item exactly once", () => {
    for (const count of [1, 24, 25, 26, 49, 50, 66, 150]) {
      const { pageCount } = page(count, 0);
      const seen: string[] = [];
      for (let i = 0; i < pageCount; i++) {
        const options = page(count, i).options;
        expect(options.length, `${count} items, page ${i}`).toBeLessThanOrEqual(25);
        seen.push(...options.map((o) => o.value).filter((v) => !v.startsWith("page:")));
      }
      expect(seen, `${count} items`).toEqual(numbers(count).map(String));
    }
  });

  it("shows the nearest valid page for an out-of-range or garbled page", () => {
    expect(page(66, 99).page).toBe(2);
    expect(page(66, -1).page).toBe(0);
    expect(page(66, Number.NaN).page).toBe(0);
  });
});

describe("pageFromValue", () => {
  it("reads page choices and ignores everything else", () => {
    expect(pageFromValue("page:2")).toBe(2);
    expect(pageFromValue("JHN")).toBeUndefined();
    expect(pageFromValue("3")).toBeUndefined();
    expect(pageFromValue("page:x")).toBeUndefined();
  });
});
