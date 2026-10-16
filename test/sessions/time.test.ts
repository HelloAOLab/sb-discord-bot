import { describe, expect, it } from "vitest";
import {
  TIME_ZONES,
  addDays,
  describeDate,
  describeHour,
  describeOffset,
  findTimeZone,
  formatLocalTime,
  fromLocalTime,
  guessTimeZone,
  parseLocalTime,
  toLocalTime,
  utcOffsetMinutes,
} from "../../src/sessions/time.js";

const utc = (iso: string) => Date.parse(iso) / 1000;

describe("fromLocalTime / toLocalTime", () => {
  it("turns a clock time in a time zone into the exact moment", () => {
    // New York is on daylight time (UTC−4) in October.
    expect(fromLocalTime({ date: "2026-10-14", hour: 19, minute: 0 }, "America/New_York")).toBe(utc("2026-10-14T23:00:00Z"));
    expect(fromLocalTime({ date: "2026-10-14", hour: 19, minute: 30 }, "Asia/Kolkata")).toBe(utc("2026-10-14T14:00:00Z"));
    expect(fromLocalTime({ date: "2026-10-14", hour: 19, minute: 0 }, "UTC")).toBe(utc("2026-10-14T19:00:00Z"));
  });

  it("uses the offset in effect on that day, across a daylight-saving change", () => {
    // New York leaves daylight time on 1 November 2026: 19:00 is then 00:00 UTC, not 23:00.
    expect(fromLocalTime({ date: "2026-11-02", hour: 19, minute: 0 }, "America/New_York")).toBe(utc("2026-11-03T00:00:00Z"));
    // The day the clocks change, both sides of 2 AM.
    expect(fromLocalTime({ date: "2026-11-01", hour: 0, minute: 30 }, "America/New_York")).toBe(utc("2026-11-01T04:30:00Z"));
    expect(fromLocalTime({ date: "2026-11-01", hour: 12, minute: 0 }, "America/New_York")).toBe(utc("2026-11-01T17:00:00Z"));
  });

  it("moves a time skipped when clocks jump forward an hour later", () => {
    // On 8 March 2026 New York's clocks jump from 2:00 to 3:00, so 2:30 doesn't exist.
    expect(fromLocalTime({ date: "2026-03-08", hour: 2, minute: 30 }, "America/New_York")).toBe(utc("2026-03-08T07:30:00Z"));
  });

  it("reads the clock in a time zone back from a moment", () => {
    expect(toLocalTime(utc("2026-10-14T23:00:00Z"), "America/New_York")).toEqual({ date: "2026-10-14", hour: 19, minute: 0 });
    expect(toLocalTime(utc("2026-10-14T23:00:00Z"), "Asia/Tokyo")).toEqual({ date: "2026-10-15", hour: 8, minute: 0 });
    expect(toLocalTime(utc("2026-10-14T00:05:00Z"), "UTC")).toEqual({ date: "2026-10-14", hour: 0, minute: 5 });
  });

  it("round-trips every listed time zone", () => {
    const local = { date: "2026-12-24", hour: 18, minute: 45 };
    for (const { id } of TIME_ZONES) expect(toLocalTime(fromLocalTime(local, id), id)).toEqual(local);
  });
});

describe("offsets", () => {
  it("finds how far a time zone is from UTC at a moment", () => {
    expect(utcOffsetMinutes(utc("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(utcOffsetMinutes(utc("2026-12-01T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(utcOffsetMinutes(utc("2026-12-01T12:00:00Z"), "Asia/Kathmandu")).toBe(345);
  });

  it("describes offsets the way people write them", () => {
    expect(describeOffset(-240)).toBe("UTC−4");
    expect(describeOffset(330)).toBe("UTC+5:30");
    expect(describeOffset(345)).toBe("UTC+5:45");
    expect(describeOffset(0)).toBe("UTC");
  });
});

describe("time zones", () => {
  it("lists only real time zones, each once", () => {
    for (const { id } of TIME_ZONES) expect(findTimeZone(id)).toBe(id);
    expect(new Set(TIME_ZONES.map((zone) => zone.id)).size).toBe(TIME_ZONES.length);
  });

  it("finds a time zone by its ID in any case, spelled the standard way", () => {
    expect(findTimeZone("america/new_york")).toBe("America/New_York");
    expect(findTimeZone(" Europe/London ")).toBe("Europe/London");
  });

  it("rejects anything else", () => {
    expect(findTimeZone("Mars/Olympus_Mons")).toBeNull();
    expect(findTimeZone("")).toBeNull();
  });

  it("guesses a time zone from the Discord language, or UTC", () => {
    expect(guessTimeZone("pt-BR")).toBe("America/Sao_Paulo");
    expect(guessTimeZone("ja")).toBe("Asia/Tokyo");
    expect(guessTimeZone("xx")).toBe("UTC");
    expect(guessTimeZone(undefined)).toBe("UTC");
  });
});

describe("formatting", () => {
  it("stores a clock time as text and reads it back", () => {
    expect(formatLocalTime({ date: "2026-10-14", hour: 9, minute: 5 })).toBe("2026-10-14T09:05");
    expect(parseLocalTime("2026-10-14T09:05")).toEqual({ date: "2026-10-14", hour: 9, minute: 5 });
  });

  it("reads garbled stored times as missing", () => {
    expect(parseLocalTime("2026-10-14T25:00")).toBeNull();
    expect(parseLocalTime("tomorrow")).toBeNull();
    expect(parseLocalTime(null)).toBeNull();
  });

  it("counts days across months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("names days and hours for the menus", () => {
    expect(describeDate("2026-10-14")).toBe("Wed, Oct 14");
    expect(describeHour(0)).toBe("00:00 · 12 AM");
    expect(describeHour(12)).toBe("12:00 · 12 PM");
    expect(describeHour(19)).toBe("19:00 · 7 PM");
  });
});
