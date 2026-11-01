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
const f = await import("./folders");
const t = await import("./templates");

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

describe("folders", () => {
  it("keep private folders to their owner and team folders to the org", async () => {
    const mine = await f.createFolder(alice, {
      name: "Mine",
      space: "private",
    });
    const team = await f.createFolder(alice, { name: "Team", space: "team" });
    const bobs = (await f.listFolders(bob)).map((folder) => folder.id);
    expect(bobs).toContain(team.id);
    expect(bobs).not.toContain(mine.id);
    expect(await f.listFolders(carol)).toEqual([]);
    // Anyone on the team may rename a team folder; no one else a private one.
    expect(await f.updateFolder(bob, team.id, { name: "Ours" })).toMatchObject({
      name: "Ours",
    });
    expect(await f.updateFolder(bob, mine.id, { name: "Hi" })).toBeNull();
    expect(await f.deleteFolder(carol, team.id)).toBe(false);
  });

  it("share a meeting filed in a team folder, and unfile it when made private", async () => {
    const team = await f.createFolder(bob, { name: "Calls", space: "team" });
    const meeting = await m.createMeeting(alice, { title: "Customer" });
    // Bob can't file Alice's private meeting; Alice can, and that shares it.
    expect(await f.addToFolder(bob, team.id, meeting.id)).toBeNull();
    expect(await f.addToFolder(alice, team.id, meeting.id)).toEqual({
      shared: true,
    });
    expect(await m.getMeeting(bob, meeting.id)).toMatchObject({
      visibility: "team",
      folders: [{ id: team.id }],
    });
    expect(
      (await m.listMeetings(bob, { folderId: team.id })).map((row) => row.id),
    ).toEqual([meeting.id]);
    expect(
      (await m.listMeetings(bob, { shared: true })).map((row) => row.id),
    ).toContain(meeting.id);
    expect(await m.listMeetings(carol, { folderId: team.id })).toEqual([]);

    await m.updateMeeting(alice, meeting.id, { visibility: "private" });
    expect(await m.getMeeting(bob, meeting.id)).toBeNull();
    expect(await m.getMeeting(alice, meeting.id)).toMatchObject({
      folders: [],
    });
  });

  it("file any readable meeting in a private folder without sharing it", async () => {
    const meeting = await m.createMeeting(alice, { title: "Mine" });
    const shelf = await f.createFolder(bob, {
      name: "Shelf",
      space: "private",
    });
    expect(await f.addToFolder(bob, shelf.id, meeting.id)).toBeNull();
    const own = await f.createFolder(alice, { name: "Own", space: "private" });
    expect(await f.addToFolder(alice, own.id, meeting.id)).toEqual({
      shared: false,
    });
    expect(await m.getMeeting(bob, meeting.id)).toBeNull();
    expect(await f.removeFromFolder(alice, own.id, meeting.id)).toBe(true);
  });
});

describe("templates", () => {
  it("pick the meeting's, then the folder's, then the owner's, then General", async () => {
    const meeting = await m.createMeeting(alice, { title: "Weekly" });
    expect((await t.resolveTemplate(meeting.id)).id).toBe("general");

    await t.setDefaultTemplateId(alice, "one-on-one");
    expect((await t.resolveTemplate(meeting.id)).id).toBe("one-on-one");

    const team = await f.createFolder(bob, { name: "Sales", space: "team" });
    await f.updateFolder(bob, team.id, { defaultTemplateId: "customer-call" });
    await f.addToFolder(alice, team.id, meeting.id);
    expect((await t.resolveTemplate(meeting.id)).id).toBe("customer-call");

    // Bob's private folder doesn't decide how Alice's notes are written.
    const bobs = await f.createFolder(bob, { name: "Bob", space: "private" });
    await f.updateFolder(bob, bobs.id, { defaultTemplateId: "interview" });
    await f.removeFromFolder(bob, team.id, meeting.id);
    await f.addToFolder(bob, bobs.id, meeting.id);
    expect((await t.resolveTemplate(meeting.id)).id).toBe("one-on-one");

    expect(await m.chooseTemplate(alice, meeting.id, "team-meeting")).toBe(
      true,
    );
    expect((await t.resolveTemplate(meeting.id)).id).toBe("team-meeting");
  });

  it("let only the owner edit a template, and the team use a team one", async () => {
    const own = await t.createTemplate(alice, {
      name: "Standup",
      instructions: "Who did what.",
      visibility: "private",
    });
    expect(await t.getTemplate(bob, own.id)).toBeNull();
    expect(await t.setDefaultTemplateId(bob, own.id)).toBe(false);
    await t.updateTemplate(alice, own.id, {
      name: "Standup",
      instructions: "Who did what.",
      visibility: "team",
    });
    expect(await t.getTemplate(bob, own.id)).toMatchObject({ mine: false });
    expect(await t.getTemplate(carol, own.id)).toBeNull();
    expect(
      await t.updateTemplate(bob, own.id, {
        name: "Mine now",
        instructions: "x",
        visibility: "team",
      }),
    ).toBeNull();

    // A deleted template falls back: here to the owner's default.
    const meeting = await m.createMeeting(bob, { title: "Daily" });
    await m.chooseTemplate(bob, meeting.id, own.id);
    expect((await t.resolveTemplate(meeting.id)).id).toBe(own.id);
    expect(await t.deleteTemplate(alice, own.id)).toBe(true);
    expect((await t.resolveTemplate(meeting.id)).id).toBe("general");
  });

  it("give a team folder only a template the whole team may use", async () => {
    const own = await t.createTemplate(alice, {
      name: "Alice's",
      instructions: "Short.",
      visibility: "private",
    });
    const team = await f.createFolder(alice, { name: "Ours", space: "team" });
    const mine = await f.createFolder(alice, {
      name: "Mine",
      space: "private",
    });
    expect(
      await f.updateFolder(alice, team.id, { defaultTemplateId: own.id }),
    ).toBeNull();
    expect(
      await f.updateFolder(alice, mine.id, { defaultTemplateId: own.id }),
    ).toMatchObject({ defaultTemplateId: own.id });
    expect(
      await f.updateFolder(bob, team.id, { defaultTemplateId: "interview" }),
    ).toMatchObject({ defaultTemplateId: "interview" });
  });

  it("show teammates that a private template was used, not its name", async () => {
    const own = await t.createTemplate(alice, {
      name: "Alice's secret format",
      instructions: "Short.",
      visibility: "private",
    });
    const meeting = await m.createMeeting(alice, { title: "Board prep" });
    await m.chooseTemplate(alice, meeting.id, own.id);
    await m.updateMeeting(alice, meeting.id, { visibility: "team" });
    expect((await m.getMeeting(alice, meeting.id))?.template).toMatchObject({
      name: "Alice's secret format",
      chosen: true,
    });
    expect((await m.getMeeting(bob, meeting.id))?.template).toEqual({
      id: "",
      name: "Private template",
      chosen: false,
    });
  });

  it("rewrite only the owner's finished notes", async () => {
    const meeting = await m.createMeeting(alice, {
      title: "Demo",
      attendees: [{ email: "x@example.com", name: "X", self: false }],
    });
    expect(
      await m.rewriteWithTemplate(alice, meeting.id, "general"),
    ).toBeNull();
    await m.finishMeeting(alice, meeting.id);
    await m.saveNotes(meeting.id, "Notes", "test-model", "general");
    expect(await m.rewriteWithTemplate(bob, meeting.id, "general")).toBeNull();
    expect(
      await m.rewriteWithTemplate(alice, meeting.id, "interview"),
    ).toMatchObject({ status: "processing", attendeeCount: 1 });
    expect(await m.getMeeting(alice, meeting.id)).toMatchObject({
      template: { id: "interview", chosen: true },
      attendees: [{ email: "x@example.com", name: "X", self: false }],
    });
  });
});
