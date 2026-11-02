import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@shared/api";
import { dueStartedNudges, planReminders, reminderId, startedId } from "../src/main/calendar/planner";
import { parseTalkUrl, resolveTalkUrl } from "../src/main/calendar/talkUrl";

const now = Date.parse("2026-11-01T10:00:00Z");
const ev = (id: string, startOffsetMin: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: `Meeting ${id}`,
  start: new Date(now + startOffsetMin * 60_000).toISOString(),
  attendees: [{ email: "me", self: true }, { email: "you" }],
  ...extra,
});

describe("reminder planner", () => {
  it("schedules one minute before meetings, skips non-meetings and started ones", () => {
    const plan = planReminders([ev("b", 30), ev("a", 10), ev("solo", 20, { attendees: [] }), ev("past", -5)], now);
    expect(plan.map((r) => [r.event.id, r.fireAt])).toEqual([
      ["a", now + 9 * 60_000],
      ["b", now + 29 * 60_000],
    ]);
  });
  it("fires a passed mark now, unless already delivered", () => {
    const soon = ev("s", 0.5);
    expect(planReminders([soon], now)[0]!.fireAt).toBe(now);
    expect(planReminders([soon], now, new Set([reminderId(soon)]))).toEqual([]);
  });
  it("skips the event being recorded", () => {
    expect(planReminders([ev("a", 10)], now, new Set(), "a")).toEqual([]);
  });
  it("gives a moved meeting a new id", () => {
    expect(reminderId(ev("a", 10))).not.toBe(reminderId(ev("a", 11)));
  });
  it("nudges once in the first five minutes, never while recording", () => {
    const started = ev("a", -2);
    expect(dueStartedNudges([started, ev("old", -6), ev("later", 5)], now, false, new Set()).map((e) => e.id)).toEqual(["a"]);
    expect(dueStartedNudges([started], now, true, new Set())).toEqual([]);
    expect(dueStartedNudges([started], now, false, new Set([startedId(started)]))).toEqual([]);
    expect(dueStartedNudges([ev("ended", -2, { end: new Date(now - 60_000).toISOString() })], now, false, new Set())).toEqual([]);
  });
});

describe("talk:// URLs", () => {
  it("parses record links", () => {
    expect(parseTalkUrl("talk://record")).toEqual({ eventId: undefined, title: undefined, start: undefined, join: false });
    expect(parseTalkUrl("talk://record?event=e1&title=Sync%0A%07&start=2026-11-01T10:00:00Z&join=1")).toEqual({
      eventId: "e1",
      title: "Sync",
      start: "2026-11-01T10:00:00.000Z",
      join: true,
    });
    expect(parseTalkUrl("talk:record?event=e1")?.eventId).toBe("e1");
    expect(parseTalkUrl(`talk://record?title=${"x".repeat(300)}`)?.title).toHaveLength(200);
  });
  it("refuses other commands and schemes", () => {
    expect(parseTalkUrl("talk://delete")).toBeUndefined();
    expect(parseTalkUrl("https://record")).toBeUndefined();
    expect(parseTalkUrl("talk://record")).toBeDefined();
    expect(parseTalkUrl("talk://record", ["talk-dev"])).toBeUndefined();
    expect(parseTalkUrl("talk-dev://record", ["talk-dev"])).toBeDefined();
  });
  it("starts at once only for a known event, with the app's own details", () => {
    const known = ev("e1", 1, { conferenceUrl: "https://meet.example.com/x" });
    expect(resolveTalkUrl({ eventId: "e1", title: "Spoofed", join: true }, [known], "Now")).toEqual({ kind: "start", event: known, join: true });
    expect(resolveTalkUrl({ eventId: "e2", title: "Other", join: true }, [known], "Now")).toEqual({ kind: "confirm", title: "Other", start: undefined, eventId: "e2" });
    expect(resolveTalkUrl({ join: false }, [known], "Now")).toMatchObject({ kind: "confirm", title: "Now" });
  });
});
