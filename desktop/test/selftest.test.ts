import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { HelperSupervisor } from "../src/main/helper/supervisor";
import { SelfTestController } from "../src/main/selftest";
import { RecordingController } from "../src/main/recording";
import { AuthService } from "../src/main/auth/service";
import { validArgs } from "../src/main/ipcValidation";
import type { HelperEvent } from "@shared/protocol";
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

async function helper(env: Record<string, string> = {}) {
  const s = new HelperSupervisor({ path: FAKE, freshToken: async () => "t", env: { FAKE_HELPER_LINE_MS: "50", ...env }, initialBackoffMs: 20 });
  supervisors.push(s);
  s.start();
  const t0 = Date.now();
  while (!(s.state.status === "ready" && s.state.permissions)) {
    if (Date.now() - t0 > 4000) throw new Error("helper not ready");
    await new Promise((r) => setTimeout(r, 10));
  }
  return s;
}

describe("self-test", () => {
  it("runs the helper's selftest.run, streams levels meanwhile, and says it's running", async () => {
    const s = await helper();
    const levels: HelperEvent[] = [];
    s.on("event", (e) => e.event === "levels" && levels.push(e));
    const t = new SelfTestController(s, () => false);
    const states: boolean[] = [];
    t.on("change", (c) => states.push(c.running));
    const report = await t.run({ seconds: 2, echoCancellation: true });
    expect(report).toMatchObject({ seconds: 2, passed: true, voiceProcessing: true, mic: { status: "ok" }, system: { status: "ok" } });
    expect(levels.length).toBeGreaterThan(3);
    expect(states).toEqual([true, false]);
    expect(t.state.running).toBe(false);
  });

  it("reports system audio 'denied' (digital silence) without failing the request", async () => {
    const t = new SelfTestController(await helper({ FAKE_HELPER_SELFTEST_SYSTEM: "denied" }), () => false);
    const report = await t.run({ seconds: 1 });
    expect(report).toMatchObject({ passed: false, system: { status: "denied", peak: 0 } });
  });

  it("refuses during a recording, and one at a time", async () => {
    const s = await helper();
    await expect(new SelfTestController(s, () => true).run()).rejects.toThrow(/Talk is recording\. Stop the recording/);
    const t = new SelfTestController(s, () => false);
    const first = t.run({ seconds: 3 });
    await expect(t.run({ seconds: 1 })).rejects.toThrow(/already running/);
    await first;
  });

  it("refuses to start a recording during a test, before making a meeting", async () => {
    const s = await helper();
    const auth = new AuthService({ store: tempStore().store, openBrowser: () => {} });
    await auth.signInWithToken(fake.origin, "epat_good");
    const recording = new RecordingController(auth, s);
    const t = new SelfTestController(s, () => recording.isActive);
    recording.startBlocked = () => (t.state.running ? "A microphone and system audio test is running." : undefined);
    const test = t.run({ seconds: 4 });
    await expect(recording.start({ title: "During a test" })).rejects.toThrow(/test is running/);
    expect(recording.state.state).toBe("idle");
    expect(fake.meetings).toEqual([]); // refused before anything reached the Worker
    await test;
    await recording.start({ title: "After the test" }); // and fine once it's done
    await recording.stop();
  });

  it("the helper also refuses record.start during a test (if main's check were bypassed)", async () => {
    const s = await helper();
    const auth = new AuthService({ store: tempStore().store, openBrowser: () => {} });
    await auth.signInWithToken(fake.origin, "epat_good");
    const recording = new RecordingController(auth, s);
    const test = new SelfTestController(s, () => false).run({ seconds: 4 });
    await expect(recording.start({ title: "Racing a test" })).rejects.toThrow(/self-test is running/);
    await test;
    expect(fake.deleted.length).toBe(1); // the meeting made for the refused start is cleaned up
  });

  it("validates the window's request", () => {
    expect(validArgs("selftest:run", [])).toBe(true);
    expect(validArgs("selftest:run", [undefined])).toBe(true);
    expect(validArgs("selftest:run", [{}])).toBe(true);
    expect(validArgs("selftest:run", [{ seconds: 15, echoCancellation: false }])).toBe(true);
    expect(validArgs("selftest:run", [{ seconds: 2 }])).toBe(true);
    for (const bad of [[{ seconds: 1 }], [{ seconds: 16 }], [{ seconds: 60 }], [{ seconds: 0 }], [{ seconds: 2.5 }], [{ seconds: "8" }], [{ echoCancellation: "yes" }], [{ seconds: 8, extra: 1 }], ["8"], [{}, 1]]) {
      expect(validArgs("selftest:run", bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
