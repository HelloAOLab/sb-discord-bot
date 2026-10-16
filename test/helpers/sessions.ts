import { createSession, type NewSession, type Session } from "../../src/storage/sessions.js";

// Reading sessions saved straight to the test database, for tests that start from an existing one.

/** The guild, channel and user the interaction helpers use. */
export const TEST_GUILD = "300000000000000001";
export const TEST_CHANNEL = "400000000000000001";
export const TEST_USER = "100000000000000001";

/** 2026-10-12 12:00 UTC, a Monday: tests that depend on the time set the clock to this. */
export const NOW = Date.UTC(2026, 9, 12, 12, 0) / 1000;

/** Saves a session planned by the test user in the test channel: Genesis 5, scheduled for an hour from NOW. */
export function saveSession(overrides: Partial<NewSession> = {}): Promise<Session> {
  return createSession({
    guildId: TEST_GUILD,
    channelId: TEST_CHANNEL,
    creatorId: TEST_USER,
    title: null,
    book: "GEN",
    bookName: "Genesis",
    chapter: 5,
    status: "scheduled",
    localTime: "2026-10-12T09:00",
    timeZone: "America/New_York",
    startAt: NOW + 60 * 60,
    reminderMinutes: 15,
    ...overrides,
  });
}
