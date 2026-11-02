import { fileURLToPath } from "node:url";
import { type Client, createClient, type InStatement } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { D1_MAX_BOUND_PARAMETERS, chunk, rowsPerStatement } from "./d1";

// SQLite binds thousands of parameters; D1 binds 100. This client refuses
// any statement over D1's limit with D1's own error, so these tests fail
// where production would.
const seen = vi.hoisted(() => ({ maxParams: 0, statements: 0 }));
function argCount(statement: InStatement): number {
  if (typeof statement === "string") return 0;
  const args = statement.args ?? [];
  return Array.isArray(args) ? args.length : Object.keys(args).length;
}
function checked(statement: InStatement): InStatement {
  const count = argCount(statement);
  seen.statements++;
  seen.maxParams = Math.max(seen.maxParams, count);
  if (count > D1_MAX_BOUND_PARAMETERS) {
    throw new Error(`D1_ERROR: too many SQL variables (${count})`);
  }
  return statement;
}
function d1Like(client: Client): Client {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "execute") {
        return (statement: InStatement, ...rest: unknown[]) =>
          (value as (...a: unknown[]) => unknown).call(
            target,
            checked(statement),
            ...rest,
          );
      }
      if (prop === "batch") {
        return (statements: InStatement[], ...rest: unknown[]) =>
          (value as (...a: unknown[]) => unknown).call(
            target,
            statements.map(checked),
            ...rest,
          );
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));
vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: () => {} }));
vi.mock("@every-app/sdk/server", () => ({
  getEveryAppUser: async (request: Request) =>
    request.headers.get("x-test-user")
      ? { id: "alice", orgId: "acme", email: "alice@acme.test" }
      : null,
}));

const m = await import("./meetings");
const f = await import("./folders");
const s = await import("./search");
const segmentsRoute = (await import("@/routes/api/v1/meetings.$id.segments"))
  .Route as {
  options: {
    server: {
      handlers: {
        POST: (ctx: {
          request: Request;
          params: Record<string, string>;
        }) => Promise<Response>;
      };
    };
  };
};

beforeAll(async () => {
  const db = drizzle(d1Like(createClient({ url: ":memory:" })), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  testDb.current = db;
});

const alice = { id: "alice", orgId: "acme" };

const segments = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({
    seq: from + i,
    startedMs: (from + i) * 1000,
    endedMs: (from + i) * 1000 + 900,
    speaker: (i % 2 ? "them" : "me") as "me" | "them",
    text: `Line ${from + i} about the backlog${from + i === 299 ? " and the wallaby" : ""}.`,
  }));

function post(id: string, body: unknown) {
  return segmentsRoute.options.server.handlers.POST({
    request: new Request(`https://talk.test/api/v1/meetings/${id}/segments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "alice" },
      body: JSON.stringify(body),
    }),
    params: { id },
  });
}

describe("D1's 100-parameter limit", () => {
  it("is enforced by the test database", async () => {
    // Sanity: one statement over the limit fails here as it does on D1.
    const meeting = await m.createMeeting(alice, { title: "Overflow" });
    const db = testDb.current as ReturnType<typeof drizzle>;
    await expect(
      db.insert(schema.transcriptSegments).values(
        segments(15).map((segment) => ({
          ...segment,
          id: crypto.randomUUID(),
          meetingId: meeting.id,
        })),
      ),
    ).rejects.toSatisfy((error: Error) =>
      /too many SQL variables/.test(String(error.cause)),
    );
  });

  it("takes a 300-segment backlog in one post, whole, once", async () => {
    const meeting = await m.createMeeting(alice, { title: "After an outage" });
    seen.maxParams = 0;
    const res = await post(meeting.id, { segments: segments(300) });
    expect(res.status).toBe(200);
    expect(seen.maxParams).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);

    const stored = (await m.getMeeting(alice, meeting.id))!.segments;
    expect(stored).toHaveLength(300);
    expect(stored.map((segment) => segment.seq)).toEqual(
      Array.from({ length: 300 }, (_, i) => i),
    );

    // A retry of the same backlog, overlapping new lines: no doubles.
    expect(
      (await post(meeting.id, [...segments(300), ...segments(20, 300)])).status,
    ).toBe(200);
    expect((await m.getMeeting(alice, meeting.id))!.segments).toHaveLength(320);

    // The search triggers indexed every inserted row.
    expect(
      (await s.searchMeetings(alice, { q: "wallaby", limit: 5 })).results,
    ).toMatchObject([{ meeting: { id: meeting.id }, field: "transcript" }]);
  });

  it("refuses more than 500 segments in one post, saying why", async () => {
    const meeting = await m.createMeeting(alice, { title: "Too many" });
    const res = await post(meeting.id, segments(501));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_body");
    expect(body.message).toContain("At most 500 segments per request");
    expect((await m.getMeeting(alice, meeting.id))!.segments).toEqual([]);
  });

  it("counts meetings in more folders than D1 binds", async () => {
    const meeting = await m.createMeeting(alice, { title: "Filed widely" });
    for (let i = 0; i < 120; i++) {
      const folder = await f.createFolder(alice, {
        name: `Folder ${String(i).padStart(3, "0")}`,
        space: "private",
      });
      if (i % 10 === 0) await f.addToFolder(alice, folder.id, meeting.id);
    }
    const listed = await f.listFoldersWithCounts(alice);
    expect(listed).toHaveLength(120);
    expect(listed.filter((folder) => folder.meetingCount === 1)).toHaveLength(
      12,
    );
  });

  it("matches a full calendar page of events", async () => {
    const recorded = await m.createMeeting(alice, {
      title: "From the calendar",
      calendarEventId: "event-97",
    });
    const ids = Array.from({ length: 150 }, (_, i) => `event-${i}`);
    expect(await m.meetingsForEvents(alice, ids)).toEqual({
      "event-97": recorded.id,
    });
  });

  it("splits by the columns per row", () => {
    expect(rowsPerStatement(7)).toBe(14);
    expect(rowsPerStatement(1, 2)).toBe(98);
    expect(() => rowsPerStatement(101)).toThrow();
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
