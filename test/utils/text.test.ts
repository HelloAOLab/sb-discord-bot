import { describe, expect, it } from "vitest";
import { escapeMarkdown } from "../../src/utils/text.js";

describe("escapeMarkdown", () => {
  it("stops bold, italics, strikethrough, code and spoilers", () => {
    expect(escapeMarkdown("**a** _b_ ~~c~~ `d` ||e||")).toBe("\\*\\*a\\*\\* \\_b\\_ \\~\\~c\\~\\~ \\`d\\` \\|\\|e\\|\\|");
  });

  it("stops masked links, which would hide where a link goes", () => {
    expect(escapeMarkdown("[Open Seed Bible](https://evil.example)")).toBe("\\[Open Seed Bible\\](https://evil.example)");
  });

  it("stops mentions and timestamps", () => {
    expect(escapeMarkdown("<@123> <@&456> <t:0:R>")).toBe("\\<@123\\> \\<@&456\\> \\<t:0:R\\>");
  });

  it("stops a line from becoming a heading, quote or list item, but leaves those characters elsewhere alone", () => {
    expect(escapeMarkdown("# Praise\n> the LORD\n- all nations\nA - B # C")).toBe("\\# Praise\n\\> the LORD\n\\- all nations\nA - B # C");
  });

  it("escapes a backslash, so it can't undo the escaping", () => {
    expect(escapeMarkdown("\\*")).toBe("\\\\\\*");
  });

  it("leaves ordinary text as it is", () => {
    expect(escapeMarkdown("For God so loved the world, that He gave (John 3:16).")).toBe(
      "For God so loved the world, that He gave (John 3:16).",
    );
  });
});
