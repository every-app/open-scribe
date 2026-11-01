import {
  ConfigurationError,
  connectUrl,
  gatewayRefusal,
  integrationFetch,
  integrationStatus,
  type OAuthClientIntegrationStatus,
} from "@every-app/sdk/server";
import { env } from "cloudflare:workers";

const PROVIDER = "google-workspace";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: { email: string | null; name: string | null; self: boolean }[];
  conferenceUrl: string | null;
  location: string | null;
}

type CalendarStatus =
  | { available: false }
  | {
      available: true;
      connected: false;
      reconnect: boolean;
      connectUrl: string;
    }
  | { available: true; connected: true };

/** Whether this person's Google Calendar is reachable; never calls Google. */
export async function calendarStatus(
  request: Request,
  returnTo: string,
): Promise<CalendarStatus> {
  let status: OAuthClientIntegrationStatus;
  try {
    status = (await integrationStatus({
      env,
      provider: PROVIDER,
      for: request,
    })) as OAuthClientIntegrationStatus;
  } catch (error) {
    // No Gateway binding and nothing in .dev.vars: local dev without Google.
    if (error instanceof ConfigurationError) return { available: false };
    throw error;
  }
  if (!status.requested || !status.configured) return { available: false };
  const connection = status.connection ?? null;
  if (connection?.ready) return { available: true, connected: true };
  return {
    available: true,
    connected: false,
    reconnect: Boolean(connection),
    connectUrl: connectUrl({ env, provider: PROVIDER, returnTo }),
  };
}

/** Google's event, the fields we read. */
interface GoogleEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean }[];
  hangoutLink?: string;
  location?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
}

/**
 * The person's upcoming events from their primary calendar. The Gateway puts
 * the held token on the call; this Worker never sees it. Throws a
 * `CalendarError` the API turns into its status.
 */
export async function upcomingEvents(
  request: Request,
  hours: number,
): Promise<CalendarEvent[]> {
  const fetchGoogle = integrationFetch({
    env,
    provider: PROVIDER,
    for: request,
  });
  const now = new Date();
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set(
    "timeMax",
    new Date(now.getTime() + hours * 3_600_000).toISOString(),
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  const response = await fetchGoogle(url);
  const refused = await gatewayRefusal(response);
  if (refused) throw new CalendarError(refused.code, refused.status);
  if (!response.ok) throw new CalendarError("google_error", response.status);
  const body = (await response.json()) as { items?: GoogleEvent[] };
  return (body.items ?? [])
    .filter((event) => event.status !== "cancelled" && event.start?.dateTime)
    .map((event) => ({
      id: event.id,
      title: event.summary ?? "(no title)",
      start: event.start!.dateTime!,
      end: event.end?.dateTime ?? event.start!.dateTime!,
      attendees: (event.attendees ?? []).map((a) => ({
        email: a.email ?? null,
        name: a.displayName ?? null,
        self: a.self === true,
      })),
      conferenceUrl:
        event.hangoutLink ??
        event.conferenceData?.entryPoints?.find(
          (entry) => entry.entryPointType === "video",
        )?.uri ??
        null,
      location: event.location ?? null,
    }));
}

export class CalendarError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`calendar: ${code}`);
  }
}
