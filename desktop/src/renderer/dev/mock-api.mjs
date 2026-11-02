#!/usr/bin/env node
// A local stand-in for Talk's /api/v1, filled with the @talk/ui playground's mock data, for
// running the real app without a Worker:
//
//   node src/renderer/dev/mock-api.mjs            # http://127.0.0.1:8788, any bearer
//   TALK_DEV_APP_URL=http://127.0.0.1:8788 TALK_DEV_TOKEN=dev pnpm dev
//
// It keeps changes in memory (jottings, notes, folders, templates, sharing) and answers the
// recording routes the fake helper calls. Node 22.18+ (it imports the playground's TypeScript).

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import * as mock from "../../../../packages/ui/playground/mocks.ts";

const port = Number(process.env.PORT ?? 8788);
const now = () => new Date().toISOString();

const db = {
  rows: [...mock.recent, ...mock.sharedMeetings, ...mock.folderMeetings.filter((m) => !mock.recent.some((r) => r.id === m.id))],
  details: new Map(),
  filed: new Map([["f-1", new Set(mock.folderMeetings.map((m) => m.id))]]),
  folders: mock.folders.map((f) => ({ ...f })),
  templates: mock.templates.map((t) => ({ ...t })),
  defaultTemplateId: "general",
};

function detail(id) {
  if (db.details.has(id)) return db.details.get(id);
  const row = db.rows.find((r) => r.id === id);
  if (!row) return null;
  const base = id === mock.meeting.id ? mock.meeting : { ...mock.meeting, segments: mock.segments.slice(0, 5) };
  const d = {
    ...base,
    ...row,
    folders: [],
    notes: row.status === "processing" || row.status === "recording" ? null : base.notes,
    jottings: row.mine ? base.jottings : null,
    shareLinks: [],
  };
  db.details.set(id, d);
  return d;
}

function foldersOf(id) {
  return db.folders.filter((f) => db.filed.get(f.id)?.has(id)).map(({ id: fid, name, space }) => ({ id: fid, name, space }));
}

function withFolders(d) {
  return { ...d, folders: foldersOf(d.id) };
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function body(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

const routes = [
  ["GET", /^\/api\/v1\/me$/, () => [200, {
    user: { id: "u-ben", email: mock.account.email, orgName: mock.account.orgName },
    calendar: { available: true, connected: true },
    google: { connected: true, connectUrl: null },
  }]],
  ["GET", /^\/api\/v1\/calendar\/upcoming$/, () => {
    // Move the mock events to today, keeping their times of day.
    const shift = new Date().setHours(0, 0, 0, 0) - new Date(mock.NOW).setHours(0, 0, 0, 0);
    const events = mock.events.map((e) => ({
      ...e,
      start: new Date(new Date(e.start).getTime() + shift).toISOString(),
      end: new Date(new Date(e.end).getTime() + shift).toISOString(),
    }));
    return [200, { events, connected: true, calendar: { available: true, connected: true } }];
  }],
  ["GET", /^\/api\/v1\/settings$/, () => [200, { settings: { defaultTemplateId: db.defaultTemplateId } }]],
  ["PATCH", /^\/api\/v1\/settings$/, (_, b) => {
    if (b.defaultTemplateId) db.defaultTemplateId = b.defaultTemplateId;
    return [200, { settings: { defaultTemplateId: db.defaultTemplateId } }];
  }],
  ["GET", /^\/api\/v1\/meetings$/, (_, __, url) => {
    const q = url.searchParams;
    let rows = db.rows;
    if (q.get("shared") === "true") rows = rows.filter((r) => !r.mine);
    else if (q.get("folderId")) rows = rows.filter((r) => db.filed.get(q.get("folderId"))?.has(r.id));
    else rows = rows.filter((r) => r.mine);
    rows = [...rows].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    return [200, { meetings: rows, nextCursor: null }];
  }],
  ["POST", /^\/api\/v1\/meetings$/, (_, b) => {
    const row = {
      id: randomUUID(), title: b.title, startsAt: b.startsAt ?? now(), endsAt: null, status: "recording",
      visibility: "private", ownerUserId: "u-ben", ownerEmail: mock.account.email,
      attendeeCount: b.attendees?.length ?? 0, mine: true,
    };
    db.rows.unshift(row);
    db.details.set(row.id, {
      ...row, attendees: (b.attendees ?? []).map((a) => ({ email: a.email ?? null, name: a.name ?? null, self: !!a.self })),
      folders: [], template: { id: "general", name: "General", chosen: false }, segments: [], notes: null, jottings: null, shareLinks: [],
    });
    return [201, { id: row.id, meeting: row }];
  }],
  ["GET", /^\/api\/v1\/meetings\/([^/]+)$/, ([id]) => {
    const d = detail(id);
    return d ? [200, { meeting: withFolders(d) }] : [404, { error: "not_found" }];
  }],
  ["PATCH", /^\/api\/v1\/meetings\/([^/]+)$/, ([id], b) => {
    const d = detail(id);
    if (!d) return [404, { error: "not_found" }];
    if (b.title) d.title = b.title;
    if (b.visibility) d.visibility = b.visibility;
    let rewriting = false;
    if (b.templateId) {
      const t = db.templates.find((x) => x.id === b.templateId);
      d.template = { id: b.templateId, name: t?.name ?? b.templateId, chosen: true };
      if (d.status !== "recording") {
        rewriting = true;
        d.status = "processing";
        setTimeout(() => {
          d.status = "done";
          d.notes = { ...(d.notes ?? mock.meeting.notes), generatedAt: now(), editedAt: null };
        }, 3000);
      }
    }
    const row = db.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { title: d.title, visibility: d.visibility, status: d.status });
    return [200, { meeting: withFolders(d), rewriting }];
  }],
  ["PUT", /^\/api\/v1\/meetings\/([^/]+)\/jottings$/, ([id], b) => {
    const d = detail(id);
    if (!d) return [404, { error: "not_found" }];
    const applied = !d.jottings || (b.updatedAt ?? now()) >= d.jottings.updatedAt;
    if (applied) d.jottings = { markdown: b.markdown, updatedAt: b.updatedAt ?? now() };
    return [200, { jottings: d.jottings, applied }];
  }],
  ["PUT", /^\/api\/v1\/meetings\/([^/]+)\/notes$/, ([id], b) => {
    const d = detail(id);
    if (!d) return [404, { error: "not_found" }];
    if (d.status === "recording" || d.status === "processing") return [409, { error: "busy" }];
    d.notes = { markdown: b.markdown, model: d.notes?.model ?? "manual", generatedAt: d.notes?.generatedAt ?? now(), editedAt: now() };
    return [200, { notes: d.notes }];
  }],
  ["POST", /^\/api\/v1\/meetings\/([^/]+)\/share$/, ([id], _, url) => {
    const d = detail(id);
    if (!d) return [404, { error: "not_found" }];
    const link = { id: randomUUID().replaceAll("-", "").slice(0, 16), createdAt: now() };
    d.shareLinks.push(link);
    return [201, { link: { id: link.id, url: `${url.origin}/s/${link.id}` } }];
  }],
  ["DELETE", /^\/api\/v1\/meetings\/([^/]+)\/share\/([^/]+)$/, ([id, linkId]) => {
    const d = detail(id);
    if (d) d.shareLinks = d.shareLinks.filter((l) => l.id !== linkId);
    return [200, { ok: true }];
  }],
  ["POST", /^\/api\/v1\/meetings\/([^/]+)\/segments$/, ([id], b) => {
    const d = detail(id);
    if (d) for (const s of b.segments ?? b) if (!d.segments.some((x) => x.seq === s.seq)) d.segments.push({ ...s, speaker: s.speaker ?? null });
    return [200, { ok: true }];
  }],
  ["POST", /^\/api\/v1\/meetings\/([^/]+)\/finish$/, ([id]) => {
    const d = detail(id);
    if (!d) return [404, { error: "not_found" }];
    d.status = "processing";
    const row = db.rows.find((r) => r.id === id);
    if (row) row.status = "processing";
    setTimeout(() => {
      d.status = "done";
      if (row) row.status = "done";
      d.notes = { markdown: `## Summary\n- ${d.segments.length} lines transcribed\n\n## From your jottings\n${d.jottings?.markdown ?? "Nothing jotted."}`, model: "mock", generatedAt: now(), editedAt: null };
    }, 4000);
    return [200, { meeting: row }];
  }],
  ["GET", /^\/api\/v1\/folders$/, () => [200, {
    folders: db.folders.map((f) => ({ ...f, meetingCount: db.filed.get(f.id)?.size ?? 0 })),
  }]],
  ["POST", /^\/api\/v1\/folders$/, (_, b) => {
    const folder = { id: randomUUID(), name: b.name, space: b.space, defaultTemplateId: null };
    db.folders.push(folder);
    return [201, { folder }];
  }],
  ["PATCH", /^\/api\/v1\/folders\/([^/]+)$/, ([id], b) => {
    const f = db.folders.find((x) => x.id === id);
    if (!f) return [404, { error: "not_found" }];
    Object.assign(f, b);
    return [200, { folder: f }];
  }],
  ["DELETE", /^\/api\/v1\/folders\/([^/]+)$/, ([id]) => {
    db.folders = db.folders.filter((f) => f.id !== id);
    return [200, { ok: true }];
  }],
  ["PUT", /^\/api\/v1\/folders\/([^/]+)\/meetings\/([^/]+)$/, ([fid, mid]) => {
    if (!db.filed.has(fid)) db.filed.set(fid, new Set());
    db.filed.get(fid).add(mid);
    const f = db.folders.find((x) => x.id === fid);
    const d = detail(mid);
    const shared = f?.space === "team" && d?.visibility === "private";
    if (shared && d) d.visibility = "team";
    return [200, { shared }];
  }],
  ["DELETE", /^\/api\/v1\/folders\/([^/]+)\/meetings\/([^/]+)$/, ([fid, mid]) => {
    db.filed.get(fid)?.delete(mid);
    return [200, { ok: true }];
  }],
  ["GET", /^\/api\/v1\/templates$/, () => [200, { templates: db.templates, defaultTemplateId: db.defaultTemplateId }]],
  ["POST", /^\/api\/v1\/templates$/, (_, b) => {
    const template = { id: randomUUID(), builtIn: false, mine: true, ...b };
    db.templates.push(template);
    return [201, { template }];
  }],
  ["PATCH", /^\/api\/v1\/templates\/([^/]+)$/, ([id], b) => {
    const t = db.templates.find((x) => x.id === id);
    if (!t) return [404, { error: "not_found" }];
    Object.assign(t, b);
    return [200, { template: t }];
  }],
  ["DELETE", /^\/api\/v1\/templates\/([^/]+)$/, ([id]) => {
    db.templates = db.templates.filter((t) => t.id !== id);
    return [200, { ok: true }];
  }],
  ["POST", /^\/api\/v1\/templates\/([^/]+)\/duplicate$/, ([id]) => {
    const t = db.templates.find((x) => x.id === id);
    if (!t) return [404, { error: "not_found" }];
    const template = { ...t, id: randomUUID(), name: `${t.name} (copy)`, builtIn: false, mine: true, visibility: "private" };
    db.templates.push(template);
    return [201, { template }];
  }],
];

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (!/^Bearer \S+/.test(req.headers.authorization ?? "")) return json(res, 401, { error: "unauthenticated" });
  for (const [method, re, handle] of routes) {
    const match = re.exec(url.pathname);
    if (!match || req.method !== method) continue;
    try {
      const [status, out] = handle(match.slice(1).map(decodeURIComponent), await body(req), url);
      return json(res, status, out);
    } catch (error) {
      return json(res, 500, { error: "internal_error", message: String(error) });
    }
  }
  json(res, 404, { error: "not_found" });
}).listen(port, "127.0.0.1", () => console.log(`mock /api/v1 on http://127.0.0.1:${port}`));
