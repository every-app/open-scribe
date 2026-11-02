// Adapting what main and /api/v1 send to what the @talk/ui screens draw.

import type { CalendarSnapshot, AuthSnapshot } from "@shared/ipc";
import type { MeResponse } from "@shared/contract";
import type { Account, CalendarEvent, ComingUp, Loadable } from "@talk/ui";
import type { CalendarConnection } from "@talk/ui";
export { loadable } from "./loadable";


const HALF_HOUR = 30 * 60_000;

/** Main polls the calendar (24 hours ahead); the Home card draws that. */
export function comingUpFrom(calendar: CalendarSnapshot | undefined, recordingEventId?: string, recordingMeetingId?: string): Loadable<ComingUp> {
  if (!calendar) return { status: "loading" };
  if (!calendar.connected) return { status: "ready", data: { state: "disconnected", reconnect: false } };
  if (calendar.error && calendar.events.length === 0) return { status: "ready", data: { state: "error", message: calendar.error } };
  if (!calendar.lastRefresh && calendar.events.length === 0) return { status: "loading" };
  const events: CalendarEvent[] = calendar.events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end ?? new Date(new Date(e.start).getTime() + HALF_HOUR).toISOString(),
    attendees: e.attendees.map((a) => ({ email: a.email ?? null, name: a.name ?? null, self: a.self ?? false })),
    conferenceUrl: e.conferenceUrl ?? null,
    location: e.location ?? null,
    meetingId: recordingEventId === e.id ? (recordingMeetingId ?? null) : null,
  }));
  return { status: "ready", data: { state: "ok", events } };
}

/** "ben@every.to" → "Ben"; the API has no display name. */
export function nameFromEmail(email: string | undefined): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const words = local.split(/[._-]+/).filter(Boolean);
  if (words.length === 0) return "You";
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

export function accountFrom(me: MeResponse | undefined, auth: AuthSnapshot | undefined): Account | null {
  const email = me?.user.email ?? auth?.email;
  if (!email) return null;
  return { name: nameFromEmail(email), email, orgName: me?.user.orgName ?? auth?.orgName ?? "Team" };
}

export function calendarConnectionFrom(me: MeResponse): CalendarConnection {
  const c = me.calendar;
  if (!c.available) return { state: "unavailable" };
  if (!c.connected) return { state: "disconnected", reconnect: c.reconnect };
  return { state: "connected", email: me.user.email };
}
