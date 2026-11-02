import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { HelperSupervisor } from "../src/main/helper/supervisor";
import { RecordingController } from "../src/main/recording";
import { AuthService } from "../src/main/auth/service";
import { parseHelperLine, type HelperEvent } from "@shared/protocol";
import type { HelperSnapshot } from "@shared/ipc";
import { FakeServer } from "./fakeServer";
import { tempStore } from "./helpers";

const FAKE = join(import.meta.dirname, "..", "scripts", "fake-helper.mjs");
let supervisors: HelperSupervisor[] = [];
let fake: FakeServer;

beforeEach(async () => {
  fake = await new FakeServer().start();
});
afterEach(async () => {
  await Promise.all(supervisors.map((s) => s.stop()));
  supervisors = [];
  await fake.stop();
});

function make(env: Record<string, string> = {}, opts: Partial<ConstructorParameters<typeof HelperSupervisor>[0]> = {}) {
  const logs: string[] = [];
  const s = new HelperSupervisor({
    path: FAKE,
    freshToken: async () => "fresh_token",
    env: { FAKE_HELPER_LINE_MS: "50", ...env },
    initialBackoffMs: 20,
    log: (l) => logs.push(l),
    ...opts,
  });
  supervisors.push(s);
  return { s, logs };
}

const until = <T>(f: () => T | undefined, ms = 4000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const v = f();
      if (v) return resolve(v);
      if (Date.now() - t0 > ms) return reject(new Error("timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });

const ready = (s: HelperSupervisor) => until(() => (s.state.status === "ready" && s.state.permissions ? s.state : undefined));

describe("protocol lines", () => {
  it("tells responses from events and drops junk", () => {
    expect(parseHelperLine('{"id":1,"ok":true,"result":{}}')).toEqual({ kind: "response", response: { id: 1, ok: true, result: {} } });
    expect(parseHelperLine('{"event":"levels","mic":0.1,"system":0}')).toMatchObject({ kind: "event", event: { event: "levels" } });
    expect(parseHelperLine("not json")).toBeNull();
    expect(parseHelperLine("[1]")).toBeNull();
    expect(parseHelperLine("")).toBeNull();
  });
});

describe("helper supervisor", () => {
  it("says hello with protocol 1 and reads permissions", async () => {
    const { s } = make();
    s.start();
    const state = await ready(s);
    expect(state).toMatchObject({ status: "ready", version: "0.0.0-fake", permissions: { mic: "granted", systemAudio: "unknown" } });
  });

  it("returns errors as HelperRequestError with the helper's code", async () => {
    const { s } = make();
    s.start();
    await ready(s);
    await expect(s.request("record.start", { meetingId: "", apiBase: "", accessToken: "" })).rejects.toMatchObject({ code: "bad_params" });
  });

  it("answers token.needed with token.update carrying a fresh token", async () => {
    const { s } = make({ FAKE_HELPER_TOKEN_NEEDED_MS: "30", FAKE_HELPER_NO_POST: "1" });
    const tokens: number[] = [];
    s.start();
    await ready(s);
    const req = s.request.bind(s);
    s.request = ((cmd: never, params: never) => {
      if (cmd === "token.update") tokens.push(1);
      return req(cmd, params);
    }) as typeof s.request;
    await s.request("record.start", { meetingId: "m1", apiBase: fake.origin, accessToken: "old" });
    await until(() => tokens.length >= 2);
    await s.request("record.stop");
  });

  it("restarts a crashed helper with growing backoff", async () => {
    const { s } = make({ FAKE_HELPER_CRASH_AFTER_MS: "80" });
    const statuses: HelperSnapshot["status"][] = [];
    s.on("status", (st) => statuses.push(st.status));
    const exits: unknown[] = [];
    s.on("exit", (e) => exits.push(e));
    s.start();
    await until(() => (s.state.restarts >= 2 ? true : undefined));
    expect(statuses).toContain("restarting");
    expect(exits[0]).toMatchObject({ code: 3, wasRecording: false });
  });

  it("re-sends call detection after a restart and forwards call events", async () => {
    const { s } = make({ FAKE_HELPER_CALL_AFTER_MS: "40" });
    const events: HelperEvent[] = [];
    s.on("event", (e) => events.push(e));
    s.start();
    await ready(s);
    await s.setDetection(true);
    await until(() => events.find((e) => e.event === "call.started"));
    expect(events.find((e) => e.event === "call.started")).toEqual({ event: "call.started", bundleId: "us.zoom.xos", appName: "zoom.us" });
  });

  it("refuses a helper that speaks another protocol, without restarting", async () => {
    const { s } = make({ FAKE_HELPER_PROTOCOL: "2" });
    s.start();
    const state = await until(() => (s.state.status === "unavailable" ? s.state : undefined));
    expect(state.lastError).toMatch(/protocol 2/);
    await new Promise((r) => setTimeout(r, 100));
    expect(s.state.restarts).toBe(0);
  });

  it("reports a missing helper as unavailable", async () => {
    const { s } = make({}, { path: "/nonexistent/talk-helper" });
    s.start();
    const state = await until(() => (s.state.status === "unavailable" ? s.state : undefined));
    expect(state.lastError).toMatch(/isn't installed/);
  });
});

describe("recording against the fake helper and fake server", () => {
  it("creates the meeting, records, posts segments and finishes", async () => {
    const auth = new AuthService({ store: tempStore().store, openBrowser: () => {} });
    await auth.signInWithToken(fake.origin, "epat_good");
    const { s } = make();
    const recording = new RecordingController(auth, s);
    s.start();
    await ready(s);
    await recording.start({ title: "Sync", calendarEventId: "ev1" });
    expect(recording.state).toMatchObject({ state: "recording", title: "Sync", calendarEventId: "ev1" });
    const meetingId = recording.state.meetingId!;
    await until(() => recording.state.lastLine);
    await recording.stop();
    expect(recording.state.state).toBe("idle");
    expect(fake.meetings[0]).toMatchObject({ id: meetingId, title: "Sync", calendarEventId: "ev1", status: "done" });
    expect((fake.segments.get(meetingId) ?? []).length).toBeGreaterThan(0);
    const post = fake.requests.find((r) => r.path.endsWith("/segments"))!;
    expect(post.headers.authorization).toBe("Bearer epat_good");
  });

  it("refuses to start when the mic is denied, and finishes nothing", async () => {
    const auth = new AuthService({ store: tempStore().store, openBrowser: () => {} });
    await auth.signInWithToken(fake.origin, "epat_good");
    const { s } = make({ FAKE_HELPER_MIC: "denied" });
    const recording = new RecordingController(auth, s);
    s.start();
    await ready(s);
    await expect(recording.start({ title: "x" })).rejects.toThrow(/Microphone access is off/);
    expect(fake.meetings).toEqual([]);
    expect(recording.state.state).toBe("idle");
  });

  it("finishes the meeting when the helper crashes mid-recording", async () => {
    const auth = new AuthService({ store: tempStore().store, openBrowser: () => {} });
    await auth.signInWithToken(fake.origin, "epat_good");
    const { s } = make({ FAKE_HELPER_CRASH_AFTER_MS: "400" });
    const recording = new RecordingController(auth, s);
    s.start();
    await ready(s);
    await recording.start({ title: "Crashy" });
    await until(() => (recording.state.state === "idle" ? recording.state : undefined));
    expect(recording.state.error).toMatch(/stopped unexpectedly/);
    await until(() => (fake.finished.length ? true : undefined));
  });
});
