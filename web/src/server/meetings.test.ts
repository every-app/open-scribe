import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

// An in-memory SQLite with the app's migrations stands in for D1.
const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));

const m = await import("./meetings");

beforeAll(async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  testDb.current = db;
});

const alice = { id: "alice", orgId: "acme" };
const bob = { id: "bob", orgId: "acme" };
const carol = { id: "carol", orgId: "other" };

describe("meetings", () => {
  it("are private to their owner until shared with the team", async () => {
    const mine = await m.createMeeting(alice, { title: "1:1" });
    expect(await m.getMeeting(bob, mine.id)).toBeNull();
    expect(
      await m.updateMeeting(bob, mine.id, { visibility: "team" }),
    ).toBeNull();

    await m.updateMeeting(alice, mine.id, { visibility: "team" });
    expect(await m.getMeeting(bob, mine.id)).toMatchObject({
      id: mine.id,
      mine: false,
      shareLinks: [],
    });
    // Another organization never sees a team meeting.
    expect(await m.getMeeting(carol, mine.id)).toBeNull();
    expect((await m.listMeetings(carol)).map((row) => row.id)).not.toContain(
      mine.id,
    );
  });

  it("take segments from the owner alone and finish once", async () => {
    const meeting = await m.createMeeting(alice, { title: "Planning" });
    const segments = {
      segments: [
        {
          seq: 0,
          startedMs: 0,
          endedMs: 1000,
          speaker: "me" as const,
          text: "Hi",
        },
        {
          seq: 1,
          startedMs: 1000,
          endedMs: 2000,
          speaker: "them" as const,
          text: "Hello",
        },
      ],
    };
    expect(await m.appendSegments(bob, meeting.id, segments)).toBe(false);
    expect(await m.appendSegments(alice, meeting.id, segments)).toBe(true);
    // A retry resends a seq: ignored, not doubled.
    expect(await m.appendSegments(alice, meeting.id, segments)).toBe(true);
    expect(await m.transcriptText(meeting.id)).toBe("me: Hi\nthem: Hello");

    expect(await m.finishMeeting(alice, meeting.id)).toMatchObject({
      status: "processing",
    });
    expect(await m.finishMeeting(alice, meeting.id)).toBeNull();
    await m.saveNotes(meeting.id, "## Summary\nHi.", "test-model");
    expect(await m.getMeeting(alice, meeting.id)).toMatchObject({
      status: "done",
      notes: { markdown: "## Summary\nHi.", model: "test-model" },
      segments: [
        { seq: 0, text: "Hi" },
        { seq: 1, text: "Hello" },
      ],
    });
  });

  it("name the speakers for whoever reads, from the guests as stored", async () => {
    const meeting = await m.createMeeting(alice, {
      title: "Intro",
      attendees: [
        { email: "alice@acme.test", self: true },
        { email: "dana@acme.example" },
      ],
    });
    await m.updateMeeting(alice, meeting.id, { visibility: "team" });
    const link = (await m.createShareLink(alice, meeting.id))!;
    expect((await m.getMeeting(alice, meeting.id))!.speakers).toEqual({
      me: "Me",
      them: "dana@acme.example",
      guests: null,
    });
    expect((await m.getMeeting(bob, meeting.id))!.speakers).toEqual({
      me: "Note-taker",
      them: "dana@acme.example",
      guests: null,
    });
    // A public link never shows an email.
    expect((await m.getSharedMeeting(link.id))!.speakers).toEqual({
      me: "Note-taker",
      them: "Them",
      guests: null,
    });
    // No event: as before for the owner.
    const bare = await m.createMeeting(alice, { title: "Quick note" });
    expect((await m.getMeeting(alice, bare.id))!.speakers).toEqual({
      me: "Me",
      them: "Them",
      guests: null,
    });
  });

  it("share by an unguessable, revocable link", async () => {
    const meeting = await m.createMeeting(alice, { title: "Demo" });
    expect(await m.createShareLink(bob, meeting.id)).toBeNull();
    const link = (await m.createShareLink(alice, meeting.id))!;
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await m.getSharedMeeting(link.id)).toMatchObject({ title: "Demo" });
    expect(await m.getSharedMeeting("nope")).toBeNull();

    expect(await m.revokeShareLink(bob, meeting.id, link.id)).toBe(false);
    expect(await m.revokeShareLink(alice, meeting.id, link.id)).toBe(true);
    expect(await m.getSharedMeeting(link.id)).toBeNull();
    expect(await m.revokeShareLink(alice, meeting.id, link.id)).toBe(false);
  });
});
