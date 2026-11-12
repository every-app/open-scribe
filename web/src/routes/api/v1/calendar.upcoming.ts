import { createFileRoute } from "@tanstack/react-router";
import { api, json, requireApiUser } from "@/server/api";
import {
  CalendarError,
  calendarStatus,
  macCalendarReturn,
  upcomingEvents,
} from "@/server/calendar";

export const Route = createFileRoute("/api/v1/calendar/upcoming")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        await requireApiUser(request);
        const url = new URL(request.url);
        const hours = Math.min(
          Math.max(Number(url.searchParams.get("hours") ?? 24) || 24, 1),
          24 * 7,
        );
        const status = await calendarStatus(
          request,
          macCalendarReturn(request),
        );
        if (!status.available || !status.connected) {
          // 409: not connected. `connectUrl` is where to send the person.
          return json(
            {
              events: [],
              connected: false,
              connectUrl: status.available ? status.connectUrl : null,
              calendar: status,
            },
            409,
          );
        }
        try {
          return json({
            events: await upcomingEvents(request, hours),
            connected: true,
            calendar: status,
          });
        } catch (error) {
          if (error instanceof CalendarError) {
            return json(
              {
                error: error.code,
                events: [],
                connected: true,
                calendar: status,
              },
              502,
            );
          }
          throw error;
        }
      }),
    },
  },
});
