#!/usr/bin/env node
// A stand-in for talk-helper that speaks helper protocol v1 (docs/desktop-plan.md) without
// touching audio. For the unit tests and for running the app without the Swift build.
//
// It fakes a transcript (a line every few seconds per speaker) and, like the real helper, posts
// the segments to `{apiBase}/api/v1/meetings/:id/segments` with the bearer it was given and calls
// `/finish` on stop. So against `everyapp dev` a fake recording leaves a real meeting behind.
//
// Knobs (env):
//   FAKE_HELPER_PROTOCOL=n        answer hello with another protocol number
//   FAKE_HELPER_CRASH_AFTER_MS=n  exit(3) n ms after start (tests restart/backoff)
//   FAKE_HELPER_CALL_AFTER_MS=n   with detection on, emit call.started after n ms (call.ended 2n)
//   FAKE_HELPER_TOKEN_NEEDED_MS=n while recording, emit token.needed every n ms
//   FAKE_HELPER_LINE_MS=n         a transcript line every n ms (default 4000)
//   FAKE_HELPER_NO_POST=1         don't call the API
//   FAKE_HELPER_MIC=granted|denied|undetermined (default granted)
// Non-protocol extra, for tests only: {"id", "cmd": "debug.emit", "params": {event...}} echoes an event.

import { createInterface } from "node:readline";

const env = process.env;
const num = (name, fallback) => (env[name] ? Number(env[name]) : fallback);
const PROTOCOL = num("FAKE_HELPER_PROTOCOL", 1);
const LINE_MS = num("FAKE_HELPER_LINE_MS", 4000);
const POST = env.FAKE_HELPER_NO_POST !== "1";

const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const log = (...args) => process.stderr.write(`fake-helper: ${args.join(" ")}\n`);
const event = (name, fields = {}) => send({ event: name, ...fields });

const permissions = { mic: env.FAKE_HELPER_MIC ?? "granted", systemAudio: "unknown" };
let rec; // { meetingId, apiBase, token, startedAt, seq, pending: [], timers: [] }
let detectTimers = [];

const LINES = {
  me: ["Thanks everyone for joining.", "Let's go through the launch plan.", "I'll send the notes after this.", "Any blockers on your side?"],
  them: ["Sounds good to me.", "The beta build is ready for review.", "We still need the signing certificate.", "Let's meet again on Thursday."],
};

async function api(path, body) {
  if (!POST || !rec) return;
  const url = new URL(path, rec.apiBase.endsWith("/") ? rec.apiBase : `${rec.apiBase}/`);
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${rec.token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    event("token.needed");
    throw Object.assign(new Error("401"), { code: "unauthorized" });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.pathname}`);
}

async function flush() {
  if (!rec || rec.pending.length === 0) return;
  const batch = rec.pending.splice(0);
  try {
    await api(`api/v1/meetings/${encodeURIComponent(rec.meetingId)}/segments`, { segments: batch });
  } catch (e) {
    rec?.pending.unshift(...batch);
    event("error", { code: "save_failed", message: String(e.message ?? e), fatal: false });
  }
}

function startRecording(params) {
  const startedAt = new Date().toISOString();
  rec = { ...params, token: params.accessToken, startedAt, t0: Date.now(), seq: 0, pending: [], timers: [], n: 0, saved: 0 };
  const state = () => ({ recording: !!rec, meetingId: rec?.meetingId, mode: "realtime", mic: "ok", system: "ok" });
  event("state", state());
  rec.timers.push(
    setInterval(() => event("levels", { mic: Math.random() * 0.6, system: Math.random() * 0.4 }), 100),
    setInterval(() => {
      if (!rec) return;
      const speaker = rec.n % 2 === 0 ? "me" : "them";
      const text = LINES[speaker][Math.floor(rec.n / 2) % LINES[speaker].length];
      const itemId = `item_${rec.n}`;
      const words = text.split(" ");
      // Like the real helper: each delta carries the whole turn so far.
      words.forEach((_, i) => setTimeout(() => rec && event("transcript.delta", { speaker, text: words.slice(0, i + 1).join(" "), itemId }), i * 60));
      const endedMs = Date.now() - rec.t0;
      const segment = { seq: rec.seq++, speaker, text, startedMs: Math.max(0, endedMs - 2500), endedMs };
      setTimeout(() => {
        if (!rec) return;
        event("transcript.segment", segment);
        rec.pending.push(segment);
      }, words.length * 60);
      rec.n++;
    }, LINE_MS),
    setInterval(() => void flush(), 10_000),
  );
  const tokenEvery = num("FAKE_HELPER_TOKEN_NEEDED_MS", 0);
  if (tokenEvery > 0) rec.timers.push(setInterval(() => event("token.needed"), tokenEvery));
  return { startedAt };
}

async function stopRecording() {
  if (!rec) throw { code: "not_recording", message: "Not recording." };
  rec.timers.forEach(clearInterval);
  await flush();
  const total = rec.seq;
  try {
    await api(`api/v1/meetings/${encodeURIComponent(rec.meetingId)}/finish`, {});
  } catch (e) {
    event("error", { code: "finish_failed", message: String(e.message ?? e), fatal: false });
  }
  rec = undefined;
  event("state", { recording: false, mode: "realtime", mic: "ok", system: "ok" });
  return { segments: total };
}

function setDetection(enabled) {
  detectTimers.forEach(clearTimeout);
  detectTimers = [];
  const after = num("FAKE_HELPER_CALL_AFTER_MS", 0);
  if (enabled && after > 0) {
    const app = { bundleId: "us.zoom.xos", appName: "zoom.us" };
    detectTimers.push(setTimeout(() => event("call.started", app), after), setTimeout(() => event("call.ended", app), after * 2));
  }
}

const handlers = {
  hello: () => ({ protocol: PROTOCOL, version: "0.0.0-fake", macos: "fake" }),
  "permissions.status": () => ({ ...permissions }),
  "permissions.request": (p) => {
    if (p?.kind === "mic" && permissions.mic === "undetermined") permissions.mic = "granted";
    return { ...permissions };
  },
  "record.start": (p) => {
    if (rec) throw { code: "already_recording", message: "Already recording." };
    if (!p?.meetingId || !p?.apiBase || !p?.accessToken) throw { code: "bad_params", message: "meetingId, apiBase and accessToken are required." };
    if (permissions.mic === "denied") throw { code: "mic_denied", message: "Microphone access is off for Talk." };
    return startRecording(p);
  },
  "record.stop": () => stopRecording(),
  "token.update": (p) => {
    if (rec && p?.accessToken) rec.token = p.accessToken;
    return {};
  },
  "detect.set": (p) => {
    setDetection(!!p?.enabled);
    return {};
  },
  "debug.emit": (p) => {
    send(p);
    return {};
  },
};

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log("not JSON:", line);
    return;
  }
  const handler = handlers[msg.cmd];
  if (!handler) return send({ id: msg.id, ok: false, error: { code: "unknown_command", message: `Unknown command ${msg.cmd}.` } });
  try {
    send({ id: msg.id, ok: true, result: await handler(msg.params) });
  } catch (e) {
    send({ id: msg.id, ok: false, error: { code: e.code ?? "error", message: e.message ?? String(e) } });
  }
});

process.stdin.on("end", async () => {
  if (rec) await stopRecording();
  process.exit(0);
});

const crashAfter = num("FAKE_HELPER_CRASH_AFTER_MS", 0);
if (crashAfter > 0) setTimeout(() => process.exit(3), crashAfter);
log("ready, protocol", PROTOCOL);
