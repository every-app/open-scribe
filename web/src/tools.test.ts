import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { callTool, listTools } from "@every-app/sdk/testing";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));

const { tools } = await import("./tools");
const { createMeeting } = await import("./server/meetings");

beforeAll(async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  testDb.current = db;
});

describe("tools", () => {
  it("lists each tool with its risk", async () => {
    const { tools: listed } = await listTools(tools);
    expect(listed.map(({ name, risk }) => [name, risk])).toEqual([
      ["get_meeting", "read"],
      ["list_folders", "read"],
      ["list_meetings", "read"],
      ["set_meeting_visibility", "write"],
    ]);
  });

  it("lists the caller's meetings only", async () => {
    const alice = { id: "alice", orgId: "org" };
    const mine = await createMeeting(alice, { title: "Standup" });
    await createMeeting({ id: "bob", orgId: "org" }, { title: "Bob's" });
    const answer = await callTool(tools, "list_meetings", {}, { user: alice });
    if ("error" in answer) throw new Error(answer.error.message);
    const text = answer.result.content.find((part) => part.type === "text");
    if (!text || text.type !== "text") throw new Error("no text content");
    expect(JSON.parse(String(text.text))).toMatchObject([{ id: mine.id }]);
  });
});
