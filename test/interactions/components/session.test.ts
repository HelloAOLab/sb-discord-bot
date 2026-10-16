import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionResponseType, MessageFlags, PermissionFlagsBits } from "discord-api-types/v10";
import { components } from "../../../src/interactions/components/index.js";
import { customId, parseCustomId } from "../../../src/interactions/components/custom-id.js";
import { sessionButtons } from "../../../src/interactions/components/session.js";
import { setSeedBibleLinksEnabled } from "../../../src/storage/guild-settings.js";
import { addParticipant, getSession, participants, type Session } from "../../../src/storage/sessions.js";
import { setUserPreferences } from "../../../src/storage/user-settings.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { buttonInteraction, withPermissions } from "../../helpers/interactions.js";
import { NOW, TEST_GUILD, TEST_USER, saveSession } from "../../helpers/sessions.js";

const OTHER_USER = { id: "100000000000000002", username: "other", global_name: "Other", discriminator: "0", avatar: null };

/** Clicks the session button for `action`, as the test user unless `overrides` says otherwise. */
function click(session: Session, action: string, overrides = {}) {
  const id = customId("session", action, session.id);
  return sessionButtons.execute(buttonInteraction(id, overrides), parseCustomId(id).args);
}

/** The same click by another member. */
function clickAsOther(session: Session, action: string, permissions = 0n) {
  const base = buttonInteraction("unused");
  return click(session, action, { member: { ...base.member!, user: OTHER_USER, permissions: permissions.toString() } });
}

// Sessions start an hour after NOW unless a test says otherwise.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("session buttons", () => {
  it("are registered under the id the messages use", () => {
    expect(components.get("session")).toBe(sessionButtons);
  });

  describe("before the session starts", () => {
    it("Join adds the user and redraws the announcement's list", async () => {
      const session = await saveSession();
      await addParticipant(session.id, "999");
      const response = await clickAsOther(session, "join");

      expect(response.type).toBe(InteractionResponseType.UpdateMessage);
      expect((response as any).data.content).toContain(`👥 Going (2): <@999>, <@${OTHER_USER.id}>`);
      expect((response as any).data.allowed_mentions).toEqual({ parse: [] });
      expect(await participants(session.id)).toEqual(["999", OTHER_USER.id]);
    });

    it("Join twice keeps the user listed once", async () => {
      const session = await saveSession();
      await click(session, "join");
      await click(session, "join");
      expect(await participants(session.id)).toEqual([TEST_USER]);
    });

    it("Leave removes the user and redraws the list", async () => {
      const session = await saveSession();
      await addParticipant(session.id, TEST_USER);
      const response = await click(session, "leave");
      expect((response as any).data.content).toContain("👥 Going (0): nobody yet");
      expect(await participants(session.id)).toEqual([]);
    });

    it("Get my link says when the session starts", async () => {
      const session = await saveSession();
      await expect(click(session, "link")).rejects.toThrow(new UserFacingError(
        `This session starts <t:${session.startAt}:R>. Click **Join** on its announcement to be pinged when it starts.`,
      ));
    });
  });

  describe("Cancel session", () => {
    it("lets the planner cancel, crossing out the announcement", async () => {
      const session = await saveSession();
      const response = await click(session, "cancel");
      expect(response).toMatchObject({ type: InteractionResponseType.UpdateMessage, data: { content: expect.stringMatching(/^~~/), components: [] } });
      expect((await getSession(session.id))!.status).toBe("cancelled");
    });

    it("lets someone with Manage Events cancel", async () => {
      const session = await saveSession();
      await clickAsOther(session, "cancel", PermissionFlagsBits.ManageEvents);
      expect((await getSession(session.id))!.status).toBe("cancelled");
    });

    it("stops anyone else", async () => {
      const session = await saveSession();
      await expect(clickAsOther(session, "cancel", PermissionFlagsBits.ManageMessages)).rejects.toThrow(/Only the person who planned this session/);
      expect((await getSession(session.id))!.status).toBe("scheduled");
    });

    it("can't cancel a session that has started", async () => {
      const session = await saveSession({ status: "started" });
      await expect(click(session, "cancel")).rejects.toThrow(new UserFacingError("This session has already started."));
    });
  });

  describe("once the session has started", () => {
    it("Get my link replies privately with the user's own link, and counts them in", async () => {
      const session = await saveSession({ status: "started" });
      await setUserPreferences(OTHER_USER.id, { translation: "BSB", lang: "es" });
      const response = await clickAsOther(session, "link");

      expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      const data = (response as any).data;
      expect(data.flags).toBe(MessageFlags.Ephemeral);
      expect(data.components[0].components[0].url).toBe(
        `https://seedbible.org/es/BSB/genesis/5?sessionId=session-${session.id}&source=discord_bot`,
      );
      expect(await participants(session.id)).toEqual([OTHER_USER.id]);
    });

    it("Join on the old announcement gives the link too", async () => {
      const session = await saveSession({ status: "started" });
      const response = await click(session, "join", { locale: "fr" });
      expect((response as any).data.components[0].components[0].url).toMatch(/^https:\/\/seedbible\.org\/fr\/AAB\/genesis\/5\?/);
      expect(await participants(session.id)).toEqual([TEST_USER]);
    });

    it("writes the link out where the server turned link buttons off", async () => {
      await setSeedBibleLinksEnabled(TEST_GUILD, false);
      const session = await saveSession({ status: "started" });
      const data = ((await click(session, "link")) as any).data;
      expect(data.components).toEqual([]);
      expect(data.content).toContain(`<https://seedbible.org/en/AAB/genesis/5?sessionId=session-${session.id}&source=discord_bot>`);
    });

    it("Leave says it's too late", async () => {
      const session = await saveSession({ status: "started" });
      await expect(click(session, "leave")).rejects.toThrow(new UserFacingError("This session has already started."));
    });
  });

  describe("past the start time, before the cron has marked it started", () => {
    const past = () => saveSession({ status: "scheduled", startAt: Math.floor(Date.now() / 1000) - 60 });

    it("Join and Get my link give the link", async () => {
      const session = await past();
      for (const action of ["join", "link"]) {
        const response = await click(session, action);
        expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource);
        expect((response as any).data.components[0].components[0].url).toContain(`sessionId=session-${session.id}`);
      }
      expect(await participants(session.id)).toEqual([TEST_USER]);
    });

    it("Leave and Cancel session say it has started, and the cron still posts its start message", async () => {
      const session = await past();
      await expect(click(session, "leave")).rejects.toThrow(new UserFacingError("This session has already started."));
      await expect(click(session, "cancel")).rejects.toThrow(new UserFacingError("This session has already started."));
      expect((await getSession(session.id))!.status).toBe("scheduled");
    });
  });

  it("explains a cancelled session on every button", async () => {
    const session = await saveSession({ status: "cancelled" });
    for (const action of ["join", "leave", "cancel", "link"]) {
      await expect(click(session, action)).rejects.toThrow(new UserFacingError("This session was cancelled."));
    }
  });

  it("rejects forged custom_ids", async () => {
    const draft = await saveSession({ status: "draft" });
    await expect(click(draft, "join")).rejects.toThrow(/no longer exists/);
    await expect(sessionButtons.execute(buttonInteraction("x"), ["join", "missing"])).rejects.toThrow(/no longer exists/);
    await expect(sessionButtons.execute(buttonInteraction("x"), ["explode", draft.id])).rejects.toThrow(/no longer works/);
    await expect(sessionButtons.execute(buttonInteraction("x"), [])).rejects.toThrow(/no longer works/);
  });

  it("checks the member's permissions, not the planner's", async () => {
    const session = await saveSession({ creatorId: "someone-else" });
    const interaction = withPermissions(buttonInteraction(customId("session", "cancel", session.id)), PermissionFlagsBits.Administrator);
    await sessionButtons.execute(interaction, ["cancel", session.id]);
    expect((await getSession(session.id))!.status).toBe("cancelled");
  });
});
