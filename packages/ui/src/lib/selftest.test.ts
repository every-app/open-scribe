import { describe, expect, it } from "vitest";
import type { SelfTestReport, SelfTestSide } from "../types";
import { selfTestLines } from "./selftest";

const side = (s: Partial<SelfTestSide> = {}): SelfTestSide => ({
  status: "ok",
  peak: 0.4,
  clipping: false,
  clippedSamples: 0,
  dropouts: 0,
  ...s,
});
const report = (
  mic: Partial<SelfTestSide>,
  system: Partial<SelfTestSide>,
): SelfTestReport => ({
  seconds: 8,
  passed: false,
  voiceProcessing: false,
  mic: side(mic),
  system: side(system),
});

describe("selfTestLines", () => {
  it("says both sides work, naming the mic", () => {
    const lines = selfTestLines(
      report({ device: "MacBook Pro Microphone" }, {}),
    );
    expect(lines.map((l) => [l.side, l.tone])).toEqual([
      ["mic", "ok"],
      ["system", "ok"],
    ]);
    expect(lines[0]!.text).toBe(
      "Your microphone works (MacBook Pro Microphone).",
    );
  });

  it("offers the right System Settings pane for each denied side", () => {
    const lines = selfTestLines(
      report({ status: "denied" }, { status: "denied" }),
    );
    expect(lines.map((l) => l.openSettings)).toEqual(["mic", "systemAudio"]);
    expect(lines[1]!.text).toMatch(
      /Play a video while testing, or allow Talk under System Settings → Privacy & Security → Screen & System Audio Recording/,
    );
  });

  it("warns softly about quiet, clipping and dropouts, and reports errors", () => {
    const lines = selfTestLines(
      report(
        { status: "silent", clipping: true, dropouts: 2 },
        { status: "error", message: "Couldn't start the tap." },
      ),
    );
    expect(lines.map((l) => l.tone)).toEqual(["warn", "warn", "warn", "bad"]);
    expect(lines[1]!.text).toMatch(/too loud/);
    expect(lines[3]!.text).toBe("Couldn't start the tap.");
  });
});
