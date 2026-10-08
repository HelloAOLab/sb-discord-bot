import { describe, expect, it } from "vitest";
import { customId, parseCustomId } from "../../../src/interactions/components/custom-id.js";

describe("customId / parseCustomId", () => {
  it("round-trips an id and its args", () => {
    const value = customId("open-picker", 3, "x");

    expect(value).toBe("open-picker:3:x");
    expect(parseCustomId(value)).toEqual({ id: "open-picker", args: ["3", "x"] });
  });

  it("parses an id with no args", () => {
    expect(parseCustomId("open-picker")).toEqual({ id: "open-picker", args: [] });
  });

  it("rejects parts containing the separator, which would shift the args", () => {
    expect(() => customId("open-picker", "a:b")).toThrow(/must not contain/);
  });

  it("rejects values over Discord's 100-character limit", () => {
    expect(() => customId("x", "y".repeat(99))).toThrow(/Discord allows 100/);
    expect(() => customId("x", "y".repeat(98))).not.toThrow();
  });
});
