import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

// The /api/v1 route handlers, called as the Worker would, against an
// in-memory SQLite with the app's migrations. Who is asking comes from the
// SDK, stubbed here to read a test header; the notes model is stubbed too.
const h = vi.hoisted(() => ({
  db: null as unknown,
  pending: [] as Promise<unknown>[],
  ai: { status: 200, content: "## Notes\nWritten." },
  prompts: [] as { role: string; content: string }[][],
}));
vi.mock("@/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("cloudflare:workers", () => ({
  env: { EVERYAPP_MANIFEST: { ai: { models: ["test-model"] } } },
  waitUntil: (promise: Promise<unknown>) => h.pending.push(promise),
}));
const users: Record<string, { id: string; orgId: string; email: string }> = {
  alice: { id: "alice", orgId: "acme", email: "alice@acme.test" },
  bob: { id: "bob", orgId: "acme", email: "bob@acme.test" },
  carol: { id: "carol", orgId: "other", email: "carol@other.test" },
};
vi.mock("@every-app/sdk/server", () => ({
  getEveryAppUser: async (request: Request) =>
    users[request.headers.get("x-test-user") ?? ""] ?? null,
  aiBaseUrl: () => "https://ai.test/v1",
  gatewayRefusal: async () => null,
  createGatewayFetch: () => async (_url: string, init: { body: string }) => {
    h.prompts.push(JSON.parse(init.body).messages);
    return Response.json(
      { choices: [{ message: { content: h.ai.content } }] },
      { status: h.ai.status },
    );
  },
}));

type Who = keyof typeof users | null;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteModule = {
  Route: unknown;
};

async function call(
  mod: RouteModule,
  method: Method,
  who: Who,
  opts: {
    params?: Record<string, string>;
    body?: unknown;
    query?: string;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const route = mod.Route as {
    options: {
      server: {
        handlers: Record<
          string,
          (ctx: {
            request: Request;
            params: Record<string, string>;
          }) => Promise<Response>
        >;
      };
    };
  };
  const handler = route.options.server.handlers[method];
  if (!handler) throw new Error(`no ${method} handler`);
  const headers = new Headers({ "content-type": "application/json" });
  if (who) headers.set("x-test-user", who);
  const request = new Request(`https://talk.test/api/v1/x${opts.query ?? ""}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const response = await handler({ request, params: opts.params ?? {} });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}

async function settle() {
  while (h.pending.length) await h.pending.shift();
}

const meetingsIndex = await import("@/routes/api/v1/meetings.index");
const meetingById = await import("@/routes/api/v1/meetings.$id.index");
const jottingsRoute = await import("@/routes/api/v1/meetings.$id.jottings");
const notesRoute = await import("@/routes/api/v1/meetings.$id.notes");
const segmentsRoute = await import("@/routes/api/v1/meetings.$id.segments");
const finishRoute = await import("@/routes/api/v1/meetings.$id.finish");
const foldersIndex = await import("@/routes/api/v1/folders.index");
const folderById = await import("@/routes/api/v1/folders.$id.index");
const filing = await import("@/routes/api/v1/folders.$id.meetings.$meetingId");
const templatesIndex = await import("@/routes/api/v1/templates.index");
const templateById = await import("@/routes/api/v1/templates.$id.index");
const duplicate = await import("@/routes/api/v1/templates.$id.duplicate");
const settingsRoute = await import("@/routes/api/v1/settings");

beforeAll(async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  h.db = db;
});

beforeEach(() => {
  h.ai = { status: 200, content: "## Notes\nWritten." };
  h.prompts = [];
});

async function newMeeting(who: Who, title: string, startsAt?: string) {
  const res = await call(meetingsIndex, "POST", who, {
    body: { title, ...(startsAt ? { startsAt } : {}) },
  });
  expect(res.status).toBe(201);
  return res.body.meeting.id as string;
}

/** Record a line and finish, so the meeting has notes and is `done`. */
async function finished(who: Who, title: string) {
  const id = await newMeeting(who, title);
  await call(segmentsRoute, "POST", who, {
    params: { id },
    body: [{ seq: 0, startedMs: 0, endedMs: 1000, speaker: "me", text: "Hi" }],
  });
  await call(finishRoute, "POST", who, { params: { id } });
  await settle();
  return id;
}

describe("/api/v1 basics", () => {
  it("refuse a request without a member, and never cache", async () => {
    const res = await call(foldersIndex, "GET", null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answer a bad body with { error, message }", async () => {
    const res = await call(foldersIndex, "POST", "alice", {
      body: { name: "", space: "nowhere" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(res.body.message).toEqual(expect.any(String));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("folders", () => {
  it("list private and team folders with the meetings each viewer can read", async () => {
    const team = (
      await call(foldersIndex, "POST", "alice", {
        body: { name: "Sales", space: "team" },
      })
    ).body.folder;
    const mine = (
      await call(foldersIndex, "POST", "alice", {
        body: { name: "Mine", space: "private" },
      })
    ).body.folder;
    expect(team).toMatchObject({ space: "team", meetingCount: 0 });

    const shared = await newMeeting("alice", "Shared call");
    const quiet = await newMeeting("alice", "Quiet call");
    expect(
      (
        await call(filing, "PUT", "alice", {
          params: { id: team.id, meetingId: shared },
        })
      ).body,
    ).toEqual({ shared: true });
    await call(filing, "PUT", "alice", {
      params: { id: mine.id, meetingId: quiet },
    });

    const bobs = (await call(foldersIndex, "GET", "bob")).body.folders;
    expect(bobs.find((f: any) => f.id === team.id)).toMatchObject({
      meetingCount: 1,
    });
    expect(bobs.find((f: any) => f.id === mine.id)).toBeUndefined();
    const alices = (await call(foldersIndex, "GET", "alice")).body.folders;
    expect(alices.find((f: any) => f.id === mine.id)).toMatchObject({
      meetingCount: 1,
    });
    expect((await call(foldersIndex, "GET", "carol")).body.folders).toEqual([]);
  });

  it("let the team change a team folder, only the owner a private one", async () => {
    const team = (
      await call(foldersIndex, "POST", "alice", {
        body: { name: "Team", space: "team" },
      })
    ).body.folder;
    const mine = (
      await call(foldersIndex, "POST", "alice", {
        body: { name: "Private", space: "private" },
      })
    ).body.folder;
    const rename = (who: Who, id: string) =>
      call(folderById, "PATCH", who, { params: { id }, body: { name: "New" } });
    expect((await rename("bob", team.id)).status).toBe(200);
    expect((await rename("bob", mine.id)).status).toBe(404);
    expect((await rename("carol", team.id)).status).toBe(404);
    expect((await rename("alice", mine.id)).body.folder.name).toBe("New");

    // A team folder's default must be a template the team may use.
    const privateTemplate = (
      await call(templatesIndex, "POST", "alice", {
        body: { name: "Mine", instructions: "Short.", visibility: "private" },
      })
    ).body.template;
    expect(
      (
        await call(folderById, "PATCH", "alice", {
          params: { id: team.id },
          body: { defaultTemplateId: privateTemplate.id },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(folderById, "PATCH", "bob", {
          params: { id: team.id },
          body: { defaultTemplateId: "customer-call" },
        })
      ).body.folder.defaultTemplateId,
    ).toBe("customer-call");

    expect(
      (await call(folderById, "DELETE", "carol", { params: { id: team.id } }))
        .status,
    ).toBe(404);
    expect(
      (await call(folderById, "DELETE", "bob", { params: { id: mine.id } }))
        .status,
    ).toBe(404);
    expect(
      (await call(folderById, "DELETE", "bob", { params: { id: team.id } }))
        .body,
    ).toEqual({ ok: true });
  });

  it("file by the web's sharing rules, and unfile from team folders on going private", async () => {
    const team = (
      await call(foldersIndex, "POST", "bob", {
        body: { name: "Calls", space: "team" },
      })
    ).body.folder;
    const meeting = await newMeeting("alice", "Customer");
    const file = (who: Who) =>
      call(filing, "PUT", who, {
        params: { id: team.id, meetingId: meeting },
      });
    // Bob can't read Alice's private meeting at all; Carol can't see either.
    expect((await file("bob")).status).toBe(404);
    expect((await file("carol")).status).toBe(404);
    expect((await file("alice")).body).toEqual({ shared: true });
    // Now the team can see it, and Bob may unfile it.
    expect(
      (
        await call(filing, "DELETE", "bob", {
          params: { id: team.id, meetingId: meeting },
        })
      ).body,
    ).toEqual({ ok: true });
    expect((await file("bob")).body).toEqual({ shared: false });

    await call(meetingById, "PATCH", "alice", {
      params: { id: meeting },
      body: { visibility: "private" },
    });
    const detail = (
      await call(meetingById, "GET", "alice", { params: { id: meeting } })
    ).body.meeting;
    expect(detail.folders).toEqual([]);
    expect(
      (await call(meetingById, "GET", "bob", { params: { id: meeting } }))
        .status,
    ).toBe(404);
  });
});

describe("templates", () => {
  it("list built-ins with the viewer's and the team's, and the default", async () => {
    const res = await call(templatesIndex, "GET", "alice");
    expect(res.body.defaultTemplateId).toBe("general");
    expect(res.body.templates[0]).toMatchObject({
      id: "general",
      builtIn: true,
    });
  });

  it("let only the owner edit or delete; the team read and duplicate a team one", async () => {
    const team = (
      await call(templatesIndex, "POST", "alice", {
        body: {
          name: "Standup",
          instructions: "Yesterday, today, blockers.",
          visibility: "team",
        },
      })
    ).body.template;
    const secret = (
      await call(templatesIndex, "POST", "alice", {
        body: { name: "Secret", instructions: "Shh.", visibility: "private" },
      })
    ).body.template;

    const get = (who: Who, id: string) =>
      call(templateById, "GET", who, { params: { id } });
    expect((await get("bob", team.id)).body.template).toMatchObject({
      name: "Standup",
      mine: false,
    });
    expect((await get("bob", secret.id)).status).toBe(404);
    expect((await get("carol", team.id)).status).toBe(404);
    expect((await get("carol", "general")).status).toBe(200);

    const patch = (who: Who, id: string, body: unknown) =>
      call(templateById, "PATCH", who, { params: { id }, body });
    expect((await patch("bob", team.id, { name: "Mine now" })).status).toBe(
      404,
    );
    expect((await patch("alice", "general", { name: "X" })).status).toBe(404);
    expect(
      (await patch("alice", team.id, { name: "Daily standup" })).body.template,
    ).toMatchObject({
      name: "Daily standup",
      instructions: "Yesterday, today, blockers.",
      visibility: "team",
    });

    const copy = await call(duplicate, "POST", "bob", {
      params: { id: team.id },
    });
    expect(copy.status).toBe(201);
    expect(copy.body.template).toMatchObject({
      name: "Daily standup (copy)",
      visibility: "private",
      mine: true,
    });
    expect(
      (await call(duplicate, "POST", "bob", { params: { id: "interview" } }))
        .body.template.name,
    ).toBe("Interview (copy)");
    expect(
      (await call(duplicate, "POST", "carol", { params: { id: team.id } }))
        .status,
    ).toBe(404);
    expect(
      (await call(duplicate, "POST", "bob", { params: { id: secret.id } }))
        .status,
    ).toBe(404);

    const del = (who: Who, id: string) =>
      call(templateById, "DELETE", who, { params: { id } });
    expect((await del("bob", team.id)).status).toBe(404);
    expect((await del("alice", "general")).status).toBe(404);
    expect((await del("alice", team.id)).body).toEqual({ ok: true });
  });
});

describe("settings", () => {
  it("are each person's, and take only a template they may use", async () => {
    expect((await call(settingsRoute, "GET", "bob")).body).toEqual({
      settings: { defaultTemplateId: "general" },
    });
    const secret = (
      await call(templatesIndex, "POST", "alice", {
        body: { name: "A's", instructions: "Mine.", visibility: "private" },
      })
    ).body.template;
    expect(
      (
        await call(settingsRoute, "PATCH", "bob", {
          body: { defaultTemplateId: secret.id },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(settingsRoute, "PATCH", "bob", {
          body: { defaultTemplateId: "one-on-one" },
        })
      ).body.settings,
    ).toEqual({ defaultTemplateId: "one-on-one" });
    expect(
      (await call(settingsRoute, "GET", "carol")).body.settings
        .defaultTemplateId,
    ).toBe("general");
    expect(
      (await call(settingsRoute, "PATCH", "bob", { body: { theme: "dark" } }))
        .status,
    ).toBe(400);
  });
});

describe("meetings", () => {
  it("list with mine, shared, search and cursor pages", async () => {
    const days = ["2030-01-01", "2030-01-02", "2030-01-03"];
    const ids: string[] = [];
    for (const day of days) {
      ids.push(await newMeeting("carol", `Roadmap ${day}`, `${day}T10:00:00Z`));
    }
    await newMeeting("carol", "Hiring 50%_ sync", "2030-01-04T10:00:00Z");

    const first = await call(meetingsIndex, "GET", "carol", {
      query: "?q=roadmap&limit=2",
    });
    expect(first.body.meetings.map((m: any) => m.id)).toEqual([ids[2], ids[1]]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await call(meetingsIndex, "GET", "carol", {
      query: `?q=roadmap&limit=2&cursor=${first.body.nextCursor}`,
    });
    expect(second.body).toMatchObject({
      meetings: [{ id: ids[0] }],
      nextCursor: null,
    });
    // LIKE wildcards in the search are literal.
    expect(
      (
        await call(meetingsIndex, "GET", "carol", {
          query: `?q=${encodeURIComponent("50%_")}`,
        })
      ).body.meetings,
    ).toHaveLength(1);
    expect(
      (await call(meetingsIndex, "GET", "carol", { query: "?q=50%25x" })).body
        .meetings,
    ).toHaveLength(0);
    expect(
      (await call(meetingsIndex, "GET", "carol", { query: "?cursor=nope" }))
        .status,
    ).toBe(400);
    expect(
      (await call(meetingsIndex, "GET", "carol", { query: "?limit=0" })).status,
    ).toBe(400);

    // Another org's member sees none of them.
    expect(
      (await call(meetingsIndex, "GET", "alice", { query: "?q=Roadmap 2030" }))
        .body.meetings,
    ).toEqual([]);
  });

  it("filter shared-with-me and mine by owner", async () => {
    const team = await newMeeting("alice", "Team sync");
    await call(meetingById, "PATCH", "alice", {
      params: { id: team },
      body: { visibility: "team" },
    });
    const ids = async (who: Who, query: string) =>
      (await call(meetingsIndex, "GET", who, { query })).body.meetings.map(
        (m: any) => m.id,
      );
    expect(await ids("bob", "?shared=true")).toContain(team);
    expect(await ids("bob", "?mine=true")).not.toContain(team);
    expect(await ids("alice", "?shared=1")).not.toContain(team);
    expect(await ids("alice", "?mine=1")).toContain(team);
  });

  it("let only the owner change or delete a meeting", async () => {
    const id = await newMeeting("alice", "Board");
    await call(meetingById, "PATCH", "alice", {
      params: { id },
      body: { visibility: "team" },
    });
    for (const who of ["bob", "carol"] as const) {
      expect(
        (
          await call(meetingById, "PATCH", who, {
            params: { id },
            body: { title: "Mine" },
          })
        ).status,
      ).toBe(404);
      expect(
        (await call(meetingById, "DELETE", who, { params: { id } })).status,
      ).toBe(404);
    }
    expect(
      (await call(meetingById, "GET", "carol", { params: { id } })).status,
    ).toBe(404);
    const renamed = await call(meetingById, "PATCH", "alice", {
      params: { id },
      body: { title: "Board meeting" },
    });
    expect(renamed.body).toMatchObject({
      meeting: { title: "Board meeting", visibility: "team" },
      rewriting: false,
    });
    expect(
      (await call(meetingById, "DELETE", "alice", { params: { id } })).body,
    ).toEqual({ ok: true });
    expect(
      (await call(meetingById, "GET", "alice", { params: { id } })).status,
    ).toBe(404);
  });

  it("choose a template while recording, rewrite with one after", async () => {
    const id = await newMeeting("alice", "Interview");
    await call(segmentsRoute, "POST", "alice", {
      params: { id },
      body: [
        { seq: 0, startedMs: 0, endedMs: 900, speaker: "them", text: "Hi" },
      ],
    });
    const patch = (body: unknown) =>
      call(meetingById, "PATCH", "alice", { params: { id }, body });
    expect((await patch({ templateId: "nope" })).status).toBe(400);
    expect((await patch({ templateId: "interview" })).body).toMatchObject({
      rewriting: false,
      meeting: { template: { id: "interview", chosen: true } },
    });
    expect((await patch({ templateId: null })).body.meeting.template).toEqual({
      id: "general",
      name: "General",
      chosen: false,
    });

    await call(finishRoute, "POST", "alice", { params: { id } });
    // Notes are being written: the template can't change under them.
    expect((await patch({ templateId: "one-on-one" })).status).toBe(409);
    await settle();

    h.ai.content = "## Updates\nRewritten.";
    expect((await patch({ templateId: "one-on-one" })).body).toMatchObject({
      rewriting: true,
      meeting: { status: "processing" },
    });
    await settle();
    expect(
      (await call(meetingById, "GET", "alice", { params: { id } })).body
        .meeting,
    ).toMatchObject({
      status: "done",
      template: { id: "one-on-one", chosen: true },
      notes: { markdown: "## Updates\nRewritten." },
    });
  });

  it("keep the earlier notes and template when a rewrite fails", async () => {
    const id = await finished("alice", "Retro");
    h.ai.status = 500;
    await call(meetingById, "PATCH", "alice", {
      params: { id },
      body: { templateId: "team-meeting" },
    });
    await settle();
    expect(
      (await call(meetingById, "GET", "alice", { params: { id } })).body
        .meeting,
    ).toMatchObject({
      status: "failed",
      template: { id: "general" },
      notes: { markdown: "## Notes\nWritten." },
    });
  });
});

describe("jottings", () => {
  it("are the owner's alone, last write winning by updatedAt", async () => {
    const id = await newMeeting("alice", "Planning");
    await call(meetingById, "PATCH", "alice", {
      params: { id },
      body: { visibility: "team" },
    });
    const put = (who: Who, body: unknown) =>
      call(jottingsRoute, "PUT", who, { params: { id }, body });

    const newer = await put("alice", {
      markdown: "- ship v1\n- hire",
      updatedAt: "2026-01-01T10:00:05Z",
    });
    expect(newer.body).toEqual({
      jottings: {
        markdown: "- ship v1\n- hire",
        updatedAt: "2026-01-01T10:00:05.000Z",
      },
      applied: true,
    });
    // A slower, older save arriving late changes nothing.
    const older = await put("alice", {
      markdown: "- ship",
      updatedAt: "2026-01-01T10:00:01Z",
    });
    expect(older.body).toMatchObject({
      applied: false,
      jottings: { markdown: "- ship v1\n- hire" },
    });
    // No time given: now, which is newer.
    expect((await put("alice", { markdown: "- ship v1" })).body).toMatchObject({
      applied: true,
      jottings: { markdown: "- ship v1" },
    });

    expect((await put("bob", { markdown: "hi" })).status).toBe(404);
    expect((await put("carol", { markdown: "hi" })).status).toBe(404);
    expect((await put("alice", { text: "hi" })).status).toBe(400);

    const own = (await call(meetingById, "GET", "alice", { params: { id } }))
      .body.meeting;
    expect(own.jottings).toMatchObject({ markdown: "- ship v1" });
    const teammate = (await call(meetingById, "GET", "bob", { params: { id } }))
      .body.meeting;
    expect(teammate.jottings).toBeNull();
  });

  it("are the outline the notes are written from", async () => {
    const id = await newMeeting("alice", "Pricing");
    await call(jottingsRoute, "PUT", "alice", {
      params: { id },
      body: { markdown: "## Pricing\n- raise to $20" },
    });
    await call(segmentsRoute, "POST", "alice", {
      params: { id },
      body: [
        {
          seq: 0,
          startedMs: 0,
          endedMs: 1000,
          speaker: "them",
          text: "We agreed on twenty dollars from March.",
        },
      ],
    });
    await call(finishRoute, "POST", "alice", { params: { id } });
    await settle();
    const [system, user] = h.prompts.at(-1)!;
    expect(system!.content).toContain("jottings are the outline");
    expect(user!.content).toContain("## Pricing\n- raise to $20");
    expect(user!.content).toContain(
      "them: We agreed on twenty dollars from March.",
    );
  });

  it("are enough to write notes when nothing was transcribed", async () => {
    const id = await newMeeting("alice", "Offline");
    await call(jottingsRoute, "PUT", "alice", {
      params: { id },
      body: { markdown: "- call the bank" },
    });
    await call(finishRoute, "POST", "alice", { params: { id } });
    await settle();
    expect(h.prompts).toHaveLength(1);
    expect(
      (await call(meetingById, "GET", "alice", { params: { id } })).body.meeting
        .notes.markdown,
    ).toBe("## Notes\nWritten.");
  });
});

describe("notes editing", () => {
  it("is the owner's, once the notes are written, and marks them edited", async () => {
    const recording = await newMeeting("alice", "Live");
    expect(
      (
        await call(notesRoute, "PUT", "alice", {
          params: { id: recording },
          body: { markdown: "x" },
        })
      ).body.error,
    ).toBe("busy");

    const id = await finished("alice", "Done");
    await call(meetingById, "PATCH", "alice", {
      params: { id },
      body: { visibility: "team" },
    });
    for (const who of ["bob", "carol"] as const) {
      expect(
        (
          await call(notesRoute, "PUT", who, {
            params: { id },
            body: { markdown: "x" },
          })
        ).status,
      ).toBe(404);
    }
    const edited = await call(notesRoute, "PUT", "alice", {
      params: { id },
      body: { markdown: "## Mine\nBetter." },
    });
    expect(edited.body.notes).toMatchObject({
      markdown: "## Mine\nBetter.",
      model: "test-model",
      editedAt: expect.any(String),
    });

    // A rewrite replaces the edit and clears editedAt.
    await call(meetingById, "PATCH", "alice", {
      params: { id },
      body: { templateId: "general" },
    });
    await settle();
    expect(
      (await call(meetingById, "GET", "bob", { params: { id } })).body.meeting
        .notes,
    ).toMatchObject({ markdown: "## Notes\nWritten.", editedAt: null });
  });
});
