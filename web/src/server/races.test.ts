import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

// Writes that race: each test starts both at once on the same database, so
// their awaits interleave as concurrent requests' would.
const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));

const m = await import("./meetings");
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

async function doneMeeting(title: string) {
  const meeting = await m.createMeeting(alice, { title });
  await m.finishMeeting(alice, meeting.id);
  await m.saveNotes(meeting.id, "## Notes\nFirst.", "test-model", "general");
  return meeting.id;
}

describe("template patches", () => {
  it("never write back a field the patch didn't name", async () => {
    const template = await t.createTemplate(alice, {
      name: "Standup",
      instructions: "Secret format.",
      visibility: "team",
    });
    await Promise.all([
      t.patchTemplate(alice, template.id, { visibility: "private" }),
      t.patchTemplate(alice, template.id, { name: "Daily standup" }),
    ]);
    expect(await t.getTemplate(alice, template.id)).toMatchObject({
      name: "Daily standup",
      visibility: "private",
    });
    expect(await t.getTemplate(bob, template.id)).toBeNull();
  });

  it("stay the owner's", async () => {
    const template = await t.createTemplate(alice, {
      name: "Mine",
      instructions: "x",
      visibility: "team",
    });
    expect(
      await t.patchTemplate(bob, template.id, { name: "Bob's" }),
    ).toBeNull();
    expect(await t.patchTemplate(alice, "general", { name: "X" })).toBeNull();
    expect(await t.patchTemplate(alice, template.id, {})).toMatchObject({
      name: "Mine",
    });
  });
});

/**
 * Run `before` just ahead of the next write to `table`, as a concurrent
 * request landing between a read and that write would.
 */
function beforeNextWrite(table: unknown, before: () => Promise<unknown>) {
  const db = testDb.current as { insert: (t: unknown) => unknown };
  const insert = db.insert.bind(db);
  const gate = <T extends object>(builder: T): T =>
    new Proxy(builder, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === "then") {
          return (ok: unknown, fail: unknown) =>
            before().then(() =>
              (value as (...a: unknown[]) => unknown).call(target, ok, fail),
            );
        }
        return typeof value === "function"
          ? (...args: unknown[]) => {
              const out = value.apply(target, args);
              return out && typeof out === "object" ? gate(out) : out;
            }
          : value;
      },
    });
  const spy = vi.spyOn(db, "insert").mockImplementation((t: unknown) => {
    if (t !== table) return insert(t);
    spy.mockRestore();
    return gate(insert(t) as object);
  });
}

describe("a notes edit racing a template rewrite", () => {
  it("is refused when the rewrite starts between its check and its write", async () => {
    const id = await doneMeeting("Race");
    beforeNextWrite(schema.notes, () =>
      m.rewriteWithTemplate(alice, id, "one-on-one"),
    );
    expect(await m.editNotes(alice, id, "## Mine")).toBe("busy");
    expect(await m.getMeeting(alice, id)).toMatchObject({
      status: "processing",
      notes: { markdown: "## Notes\nFirst.", editedAt: null },
    });
  });

  it("lands, and is then replaced, when it commits before the rewrite starts", async () => {
    const id = await doneMeeting("Edit first");
    expect(await m.editNotes(alice, id, "## Mine")).toMatchObject({
      markdown: "## Mine",
      editedAt: expect.any(String),
    });
    await m.rewriteWithTemplate(alice, id, "one-on-one");
    await m.saveNotes(id, "## Rewritten", "test-model", "one-on-one");
    expect(await m.getMeeting(alice, id)).toMatchObject({
      status: "done",
      notes: { markdown: "## Rewritten", editedAt: null },
      template: { id: "one-on-one" },
    });
  });

  it("can't be overwritten by notes saved after the rewrite stopped", async () => {
    // A rewrite that failed (or a meeting no longer processing): a late
    // save from it must not replace what the owner wrote since.
    const id = await doneMeeting("Late save");
    await m.rewriteWithTemplate(alice, id, "one-on-one");
    await m.markFailed(id);
    await m.editNotes(alice, id, "## Mine");
    await m.saveNotes(id, "## Late", "test-model", "one-on-one");
    expect(await m.getMeeting(alice, id)).toMatchObject({
      status: "failed",
      notes: { markdown: "## Mine" },
      template: { id: "general" },
    });
  });

  it("is refused while recording or processing, and from anyone else", async () => {
    const live = await m.createMeeting(alice, { title: "Live" });
    expect(await m.editNotes(alice, live.id, "x")).toBe("busy");
    expect(await m.editNotes(bob, live.id, "x")).toBeNull();
    const id = await doneMeeting("Others");
    expect(await m.editNotes(bob, id, "x")).toBeNull();
    // A first edit of a failed meeting with no notes creates them.
    const failed = await m.createMeeting(alice, { title: "Failed" });
    await m.finishMeeting(alice, failed.id);
    await m.markFailed(failed.id);
    expect(await m.editNotes(alice, failed.id, "## Typed")).toMatchObject({
      markdown: "## Typed",
      model: "manual",
    });
  });
});
