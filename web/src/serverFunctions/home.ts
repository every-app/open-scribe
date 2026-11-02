import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { gatewayUrl } from "@every-app/sdk/server";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { env } from "cloudflare:workers";
import type { CalendarEvent } from "@/api/contract";
import {
  CalendarError,
  calendarStatus,
  upcomingEvents,
} from "@/server/calendar";
import { meetingsForEvents } from "@/server/meetings";

/** Who is signed in, Google, the Mac app's sign-in, and the way back. */
export const getAccount = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context: { user } }) => {
    const request = getRequest();
    const origin = new URL(request.url).origin;
    return {
      user: { email: user.email, orgName: user.orgName ?? "your workspace" },
      calendar: await calendarStatus(request, origin),
      appUrl: origin,
      launcher: gatewayUrl(env),
      tokensUrl: gatewayUrl(env, "/admin/tokens"),
    };
  });

export type ComingUp =
  | { state: "unavailable" }
  | { state: "disconnected"; connectUrl: string; reconnect: boolean }
  | { state: "error"; message: string }
  | {
      state: "ok";
      events: (CalendarEvent & { meetingId: string | null })[];
    };

/** The next two weeks of the person's calendar, each with its notes if any. */
export const getComingUp = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context: { user } }): Promise<ComingUp> => {
    const request = getRequest();
    const status = await calendarStatus(request, new URL(request.url).origin);
    if (!status.available) return { state: "unavailable" };
    if (!status.connected) {
      return {
        state: "disconnected",
        connectUrl: status.connectUrl,
        reconnect: status.reconnect,
      };
    }
    try {
      // Google's timeMin bounds the end, so a meeting under way is in.
      const events = await upcomingEvents(request, 14 * 24);
      const recorded = await meetingsForEvents(
        user,
        events.map((event) => event.id),
      );
      return {
        state: "ok",
        events: events.map((event) => ({
          ...event,
          meetingId: recorded[event.id] ?? null,
        })),
      };
    } catch (error) {
      if (error instanceof CalendarError) {
        return { state: "error", message: "Couldn't reach Google Calendar." };
      }
      throw error;
    }
  });
