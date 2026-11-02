import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelperEvent } from "@shared/protocol";
import { isAllowedApiCall, isValidApiCallOptions } from "../src/main/api/routes";
import { emptyTranscript, mergeSegments, partialOf, reduceTranscript, type LiveTranscript } from "../src/renderer/src/live";
import { DebouncedSaver } from "../src/renderer/src/saver";

const run = (events: HelperEvent[], from: LiveTranscript = emptyTranscript) => events.reduce(reduceTranscript, from);

describe("live transcript", () => {
  it("keeps the latest text per itemId and clears it when the speaker's segment lands", () => {
    let s = run([
      { event: "state", recording: true, meetingId: "m1", mode: "realtime", mic: "ok", system: "ok" },
      { event: "transcript.delta", speaker: "them", itemId: "a", text: "Sounds" },
      { event: "transcript.delta", speaker: "them", itemId: "a", text: "Sounds good" },
      { event: "transcript.delta", speaker: "me", itemId: "b", text: "Right" },
    ]);
    expect(s.meetingId).toBe("m1");
    expect(partialOf(s)).toEqual({ me: "Right", them: "Sounds good" });
    s = run([{ event: "transcript.segment", seq: 1, speaker: "them", text: "Sounds good.", startedMs: 0, endedMs: 900 }], s);
    expect(partialOf(s)).toEqual({ me: "Right", them: "" });
    expect(s.segments.map((x) => x.text)).toEqual(["Sounds good."]);
  });

  it("ignores a repeated seq and starts clean for a new meeting", () => {
    const seg: HelperEvent = { event: "transcript.segment", seq: 3, speaker: "me", text: "Hi", startedMs: 0, endedMs: 1 };
    let s = run([{ event: "state", recording: true, meetingId: "m1", mode: "realtime", mic: "ok", system: "ok" }, seg, seg]);
    expect(s.segments).toHaveLength(1);
    s = run([{ event: "state", recording: true, meetingId: "m2", mode: "realtime", mic: "ok", system: "ok" }], s);
    expect(s).toEqual({ ...emptyTranscript, meetingId: "m2" });
  });

  it("merges saved and live segments by seq", () => {
    const a = { seq: 1, startedMs: 0, endedMs: 1, speaker: "me" as const, text: "a" };
    const b = { seq: 2, startedMs: 1, endedMs: 2, speaker: "them" as const, text: "b" };
    expect(mergeSegments([b], [a, b]).map((s) => s.seq)).toEqual([1, 2]);
  });
});

describe("jottings saver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves once after typing pauses, with the time of the last change", async () => {
    const save = vi.fn(async () => {});
    let t = 0;
    const saver = new DebouncedSaver(save, undefined, 800, () => new Date(Date.UTC(2026, 10, 2, 10, 0, t)));
    saver.change("a");
    t = 1;
    await vi.advanceTimersByTimeAsync(500);
    saver.change("ab");
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("ab", "2026-11-02T10:00:01.000Z");
  });

  it("flushes a pending save at once, and reports a failure", async () => {
    const onError = vi.fn();
    const saver = new DebouncedSaver(async () => Promise.reject(new Error("offline")), onError);
    saver.change("x");
    await saver.flush();
    expect(onError).toHaveBeenCalledOnce();
    await saver.flush(); // nothing pending: no second call
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("api:call allowlist", () => {
  it("lets the window's routes through", () => {
    expect(isAllowedApiCall("GET", "api/v1/meetings")).toBe(true);
    expect(isAllowedApiCall("PUT", "api/v1/meetings/abc-123/jottings")).toBe(true);
    expect(isAllowedApiCall("DELETE", "api/v1/meetings/m1/share/l1")).toBe(true);
    expect(isAllowedApiCall("PUT", "api/v1/folders/f1/meetings/m1")).toBe(true);
    expect(isAllowedApiCall("POST", "api/v1/templates/general/duplicate")).toBe(true);
  });

  it("refuses recording routes, other methods, traversal and other hosts", () => {
    expect(isAllowedApiCall("POST", "api/v1/meetings/m1/segments")).toBe(false);
    expect(isAllowedApiCall("POST", "api/v1/meetings/m1/transcription-token")).toBe(false);
    expect(isAllowedApiCall("DELETE", "api/v1/me")).toBe(false);
    expect(isAllowedApiCall("GET", "api/v1/meetings/../../admin")).toBe(false);
    expect(isAllowedApiCall("GET", "https://evil.example/api/v1/me")).toBe(false);
    expect(isAllowedApiCall("TRACE", "api/v1/me")).toBe(false);
  });

  it("checks options", () => {
    expect(isValidApiCallOptions(undefined)).toBe(true);
    expect(isValidApiCallOptions({ query: { limit: "40" }, body: { a: 1 } })).toBe(true);
    expect(isValidApiCallOptions({ query: { limit: 40 } })).toBe(false);
    expect(isValidApiCallOptions({ headers: {} })).toBe(false);
  });
});

describe("cancelled start", () => {
  it("is a stop that lands in idle before the recording ever started", async () => {
    const { wasCancelledStart } = await import("../src/renderer/src/recording");
    const starting = { state: "starting", meetingId: "m1", calendarEventId: "e1" } as const;
    const stoppingEarly = { ...starting, state: "stopping" } as const;
    expect(wasCancelledStart(starting, { state: "idle" })).toBe(true);
    expect(wasCancelledStart(stoppingEarly, { state: "idle" })).toBe(true);
    // A normal stop: it had started.
    expect(wasCancelledStart({ state: "stopping", meetingId: "m1", startedAt: "2026-11-02T10:00:00Z" }, { state: "idle" })).toBe(false);
    // A start that failed is an error, not a cancel.
    expect(wasCancelledStart(starting, { state: "idle", error: "Microphone access is off" })).toBe(false);
    expect(wasCancelledStart(undefined, { state: "idle" })).toBe(false);
    expect(wasCancelledStart(starting, { state: "recording", startedAt: "x" })).toBe(false);
  });
});
