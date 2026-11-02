// `talk://record[?event=<calendarEventId>&title=<t>&start=<ISO 8601>&join=1]`, opened by the web
// app's Record buttons (port of TalkCore/TalkURL.swift). Any web page can open one, so nothing in
// it is trusted: Talk starts at once only for an event in its own upcoming list.

import { flexibleDate, type CalendarEvent } from "@shared/api";

const MAX_TITLE = 200;

export interface TalkUrl {
  eventId?: string;
  title?: string;
  start?: string;
  join: boolean;
}

/** undefined for anything but a `talk://record` URL. `schemes` are the ones this build owns
 * (a dev build owns `talk-dev`, so it never takes links meant for the installed app). */
export function parseTalkUrl(raw: string, schemes: readonly string[] = ["talk"]): TalkUrl | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!schemes.includes(url.protocol.toLowerCase().replace(/:$/, ""))) return undefined;
  // `talk://record` puts it in the host; `talk:record` in the path.
  const command = (url.host || url.pathname).replace(/^\/+|\/+$/g, "").toLowerCase();
  if (command !== "record") return undefined;
  const value = (name: string) => {
    const v = url.searchParams.get(name)?.trim();
    return v ? v : undefined;
  };
  // eslint-disable-next-line no-control-regex
  const title = value("title")?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, MAX_TITLE);
  const join = ["1", "true", "yes"].includes((value("join") ?? "").toLowerCase());
  return { eventId: value("event"), title: title || undefined, start: flexibleDate(value("start"))?.toISOString(), join };
}

export type TalkUrlAction =
  /** An event the app already knows: start at once, with the app's own details. */
  | { kind: "start"; event: CalendarEvent; join: boolean }
  /** Anything else: ask the person first. Never opens a link from the URL. */
  | { kind: "confirm"; title: string; start?: string; eventId?: string };

export function resolveTalkUrl(request: TalkUrl, upcoming: CalendarEvent[], fallbackTitle: string): TalkUrlAction {
  const event = request.eventId ? upcoming.find((e) => e.id === request.eventId) : undefined;
  if (event) return { kind: "start", event, join: request.join };
  return { kind: "confirm", title: request.title ?? fallbackTitle, start: request.start, eventId: request.eventId };
}
