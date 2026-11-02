import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HelperEvent } from "@shared/protocol";
import { combinePermissions, PermissionProbe } from "../src/main/permissions";

const tempPath = () => join(mkdtempSync(join(tmpdir(), "talk-perms-")), "permissions.json");
const levels = (system: number, mic = 0.2): HelperEvent => ({ event: "levels", mic, system });
const helperSays = { mic: "granted", systemAudio: "unknown" } as const;

describe("system audio probe", () => {
  it("stays unknown while the tap is silent", () => {
    const probe = new PermissionProbe(tempPath());
    probe.load();
    expect(probe.observe(levels(0))).toBe(false);
    expect(probe.observe(levels(0.001))).toBe(false);
    expect(probe.observe({ event: "state", recording: true, mode: "realtime", mic: "ok", system: "ok" })).toBe(false);
    expect(probe.snapshot(helperSays).systemAudio).toBe("unknown");
  });

  it("is verified by the first sound on the system channel, and remembers it", () => {
    const path = tempPath();
    const probe = new PermissionProbe(path);
    probe.load();
    let changes = 0;
    probe.on("change", () => changes++);
    expect(probe.observe(levels(0.05))).toBe(true);
    expect(probe.observe(levels(0.3))).toBe(false);
    expect(changes).toBe(1);
    expect(probe.snapshot(helperSays)).toEqual({ mic: "granted", systemAudio: "verified", notifications: "unknown" });
    expect(JSON.parse(readFileSync(path, "utf8")).systemAudioVerifiedAt).toEqual(expect.any(String));
    const again = new PermissionProbe(path);
    again.load();
    expect(again.systemAudioVerified).toBe(true);
  });

  it("ignores mic sound and junk levels", () => {
    const probe = new PermissionProbe(tempPath());
    probe.load();
    expect(probe.observe(levels(0, 0.9))).toBe(false);
    expect(probe.observe({ event: "levels", mic: 0, system: "loud" } as never)).toBe(false);
    expect(probe.systemAudioVerified).toBe(false);
  });

  it("remembers the notification answer", () => {
    const path = tempPath();
    const probe = new PermissionProbe(path);
    probe.load();
    probe.notificationResult(false);
    expect(probe.snapshot(helperSays).notifications).toBe("denied");
    probe.notificationResult(true);
    const again = new PermissionProbe(path);
    again.load();
    expect(again.snapshot(helperSays).notifications).toBe("granted");
  });

  it("treats a broken file as nothing seen", () => {
    const path = tempPath();
    writeFileSync(path, '{"systemAudioVerifiedAt": 5, "notifications": "maybe"}');
    const probe = new PermissionProbe(path);
    probe.load();
    expect(probe.snapshot(undefined)).toEqual({ mic: "unknown", systemAudio: "unknown", notifications: "unknown" });
  });
});

describe("combining with the helper", () => {
  it("lets the helper's answer win when it has one", () => {
    expect(combinePermissions({ mic: "denied", systemAudio: "denied" }, { systemAudioVerified: true }).systemAudio).toBe("denied");
    expect(combinePermissions({ mic: "granted", systemAudio: "granted" }, { systemAudioVerified: false }).systemAudio).toBe("granted");
    expect(combinePermissions({ mic: "undetermined", systemAudio: "undetermined" }, { systemAudioVerified: true })).toEqual({
      mic: "undetermined",
      systemAudio: "verified",
      notifications: "unknown",
    });
    expect(combinePermissions(undefined, { systemAudioVerified: false, notifications: "granted" })).toEqual({
      mic: "unknown",
      systemAudio: "unknown",
      notifications: "granted",
    });
  });
});
