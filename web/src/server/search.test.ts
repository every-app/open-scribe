import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

// Search runs on an in-memory SQLite (FTS5 included) with the app's
// migrations, as D1 would.
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
const s = await import("./search");
const searchRoute = (await import("@/routes/api/v1/search")).Route as {
  options: {
    server: {
      handlers: {
        GET: (ctx: {
          request: Request;
          params: Record<string, string>;
        }) => Promise<Response>;
      };
    };
  };
};

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

beforeAll(async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder });
  testDb.current = db;
});

const alice = { id: "alice", orgId: "acme" };
const bob = { id: "bob", orgId: "acme" };
const carol = { id: "carol", orgId: "other" };

const search = (viewer: typeof alice, q: string, limit = 20, cursor?: string) =>
  s.searchMeetings(viewer, { q, limit, cursor });
const ids = async (viewer: typeof alice, q: string) =>
  (await search(viewer, q)).results.map((result) => result.meeting.id);

async function meetingWith(
  owner: typeof alice,
  title: string,
  content: {
    team?: boolean;
    lines?: string[];
    notes?: string;
    jottings?: string;
    startsAt?: string;
  } = {},
) {
  const meeting = await m.createMeeting(owner, {
    title,
    ...(content.startsAt ? { startsAt: content.startsAt } : {}),
  });
  if (content.team) {
    await m.updateMeeting(owner, meeting.id, { visibility: "team" });
  }
  if (content.lines?.length) {
    await m.appendSegments(owner, meeting.id, {
      segments: content.lines.map((text, seq) => ({
        seq,
        startedMs: seq * 1000,
        endedMs: seq * 1000 + 900,
        speaker: "them" as const,
        text,
      })),
    });
  }
  if (content.jottings) {
    await m.saveJottings(owner, meeting.id, { markdown: content.jottings });
  }
  if (content.notes) {
    await m.finishMeeting(owner, meeting.id);
    await m.saveNotes(meeting.id, content.notes, "test-model");
  }
  return meeting.id;
}

describe("search", () => {
  it("applies the meeting list's visibility rules", async () => {
    const secret = await meetingWith(alice, "Aardvark planning");
    const shared = await meetingWith(alice, "Aardvark launch", { team: true });
    expect(new Set(await ids(alice, "aardvark"))).toEqual(
      new Set([secret, shared]),
    );
    expect(await ids(bob, "aardvark")).toEqual([shared]);
    expect(await ids(carol, "aardvark")).toEqual([]);

    // Made private again: gone for the teammate.
    await m.updateMeeting(alice, shared, { visibility: "private" });
    expect(await ids(bob, "aardvark")).toEqual([]);
  });

  it("never matches a teammate's jottings", async () => {
    const id = await meetingWith(alice, "Board prep", {
      team: true,
      jottings: "- zanzibar acquisition, keep quiet",
      lines: ["Let's review the board deck."],
    });
    const own = await search(alice, "zanzibar");
    expect(own.results).toMatchObject([{ meeting: { id }, field: "jottings" }]);
    expect(await ids(bob, "zanzibar")).toEqual([]);
    // The parts the teammate may read still match.
    expect(await ids(bob, "board deck")).toEqual([id]);
  });

  it("finds titles, notes and transcripts, and says which", async () => {
    const id = await meetingWith(bob, "Weekly sync", {
      lines: ["The quokka migration is blocked on legal."],
      notes: "## Decisions\n- Ship the wombat release Friday.",
    });
    expect((await search(bob, "quokka")).results[0]).toMatchObject({
      meeting: { id, mine: true },
      field: "transcript",
    });
    expect((await search(bob, "wombat")).results[0]!.field).toBe("notes");
    expect((await search(bob, "weekly")).results[0]!.field).toBe("title");
    // Prefixes and accents.
    expect(await ids(bob, "quok")).toEqual([id]);
    expect(await ids(bob, "WÓMBAT")).toEqual([id]);
    // Every word must match.
    expect(await ids(bob, "quokka wombat")).toEqual([]);
  });

  it("stays in step with edits and deletes", async () => {
    const id = await meetingWith(bob, "Ocelot review", {
      notes: "Old notes about penguins.",
    });
    await m.updateMeeting(bob, id, { title: "Lynx review" });
    expect(await ids(bob, "ocelot")).toEqual([]);
    expect(await ids(bob, "lynx")).toEqual([id]);

    await m.editNotes(bob, id, "New notes about puffins.");
    expect(await ids(bob, "penguins")).toEqual([]);
    expect(await ids(bob, "puffins")).toEqual([id]);

    await m.deleteMeeting(bob, id);
    expect(await ids(bob, "lynx")).toEqual([]);
    expect(await ids(bob, "puffins")).toEqual([]);
  });

  it("ranks a title match above a passing mention in a transcript", async () => {
    const mention = await meetingWith(alice, "Ops standup", {
      startsAt: "2030-01-02T10:00:00Z",
      lines: [
        "Lots of things today, the database, hiring, and briefly the narwhal.",
      ],
    });
    const titled = await meetingWith(alice, "Narwhal kickoff", {
      startsAt: "2030-01-01T10:00:00Z",
    });
    expect(await ids(alice, "narwhal")).toEqual([titled, mention]);
  });

  it("returns plain text with match ranges, never markup", async () => {
    const id = await meetingWith(alice, "Security", {
      notes:
        'We discussed <script>alert("x")</script> and the <b>pelican</b> pricing\u0002 model.',
    });
    const [result] = (await search(alice, "pelican")).results;
    expect(result!.meeting.id).toBe(id);
    const { text, ranges } = result!.snippet;
    // Raw text, as written: the client escapes it when it renders.
    expect(text).toContain('<script>alert("x")</script>');
    expect(text).toContain("<b>pelican</b>");
    expect(text).not.toMatch(/[\u0002\u0003]/);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toBe("pelican");
  });

  it("treats query syntax as words", async () => {
    await meetingWith(alice, "Gecko notes");
    for (const q of [
      'gecko"',
      "gecko*",
      "^gecko",
      "(gecko)",
      "gecko:",
      "-gecko",
    ]) {
      expect(await ids(alice, q), q).toHaveLength(1);
    }
    // Operators and column filters are words like any other: all required.
    for (const q of ['gecko OR "', "title:gecko", "gecko NEAR(x)"]) {
      expect(await ids(alice, q), q).toEqual([]);
    }
    expect((await search(alice, '"*()')).results).toEqual([]);
    expect(s.toMatchQuery('a "b" OR c*')).toBe('"a"* "b"* "OR"* "c"*');
  });

  it("pages with a cursor", async () => {
    for (const day of ["01", "02", "03"]) {
      await meetingWith(carol, `Platypus ${day}`, {
        startsAt: `2030-02-${day}T10:00:00Z`,
      });
    }
    const first = await search(carol, "platypus", 2);
    expect(first.results).toHaveLength(2);
    expect(first.nextCursor).toBe("2");
    const second = await search(carol, "platypus", 2, first.nextCursor!);
    expect(second.results).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.results, ...second.results].map(
      (r) => r.meeting.title,
    );
    expect(new Set(all).size).toBe(3);
    await expect(search(carol, "platypus", 2, "abc")).rejects.toThrow();
  });

  it("parses snippets into text and ranges", () => {
    expect(s.parseSnippet("…a \u0002Big\u0003 deal, \u0002big\u0003…")).toEqual(
      {
        text: "…a Big deal, big…",
        ranges: [
          { start: 3, end: 6 },
          { start: 13, end: 16 },
        ],
      },
    );
    expect(s.parseSnippet("no match")).toEqual({
      text: "no match",
      ranges: [],
    });
  });
});

describe("GET /api/v1/search", () => {
  const get = (query: string, signedIn = true) =>
    searchRoute.options.server.handlers.GET({
      request: new Request(`https://scribe.test/api/v1/search${query}`, {
        headers: signedIn ? { "x-test-user": "alice" } : {},
      }),
      params: {},
    });

  it("refuses a request without a member", async () => {
    expect((await get("?q=x", false)).status).toBe(401);
  });

  it("checks the query and answers the contract's shape", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?q=x&limit=500")).status).toBe(400);
    expect((await get("?q=x&cursor=nope")).status).toBe(400);
    const id = await meetingWith(alice, "Capybara offsite");
    const res = await get("?q=capybara");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      results: [
        {
          meeting: expect.objectContaining({ id, title: "Capybara offsite" }),
          field: "title",
          snippet: {
            text: "Capybara offsite",
            ranges: [{ start: 0, end: 8 }],
          },
        },
      ],
      nextCursor: null,
    });
  });
});

describe("the search migration", () => {
  it("backfills meetings that existed before it", async () => {
    // Apply the migrations before 0004, write rows, then apply the rest.
    const dir = mkdtempSync(join(tmpdir(), "scribe-migrations-"));
    cpSync(migrationsFolder, dir, { recursive: true });
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const before = {
      ...journal,
      entries: journal.entries.filter(
        (entry: { tag: string }) => entry.tag < "0004",
      ),
    };
    writeFileSync(journalPath, JSON.stringify(before));

    const db = drizzle(createClient({ url: ":memory:" }), { schema });
    await migrate(db, { migrationsFolder: dir });
    await db.insert(schema.meetings).values({
      id: "old-meeting",
      orgId: "acme",
      ownerUserId: "alice",
      title: "Legacy armadillo",
      startsAt: "2025-01-01T10:00:00Z",
      status: "done",
    });
    await db.insert(schema.transcriptSegments).values({
      id: "seg-1",
      meetingId: "old-meeting",
      seq: 0,
      startedMs: 0,
      endedMs: 1000,
      speaker: "me",
      text: "We talked about the iguana.",
    });
    await db
      .insert(schema.notes)
      .values({ meetingId: "old-meeting", markdown: "Toucan.", model: "x" });
    await db.insert(schema.jottings).values({
      meetingId: "old-meeting",
      markdown: "flamingo",
      updatedAt: "2025-01-01T10:30:00Z",
    });

    writeFileSync(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: dir });

    const previous = testDb.current;
    testDb.current = db;
    try {
      for (const [q, field] of [
        ["armadillo", "title"],
        ["iguana", "transcript"],
        ["toucan", "notes"],
        ["flamingo", "jottings"],
      ] as const) {
        expect((await search(alice, q)).results, q).toMatchObject([
          { meeting: { id: "old-meeting" }, field },
        ]);
      }
      expect(await ids(bob, "armadillo")).toEqual([]);
    } finally {
      testDb.current = previous;
    }
  });
});
