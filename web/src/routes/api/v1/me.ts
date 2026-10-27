import { createFileRoute } from "@tanstack/react-router";
import { api, json, requireApiUser } from "@/server/api";
import { calendarStatus } from "@/server/calendar";

export const Route = createFileRoute("/api/v1/me")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const calendar = await calendarStatus(
          request,
          new URL(request.url).origin,
        );
        return json({
          user: {
            id: user.id,
            email: user.email,
            orgName: user.orgName ?? null,
          },
          calendar,
          // The short form the Mac app reads.
          google: {
            connected: calendar.available && calendar.connected,
            connectUrl:
              calendar.available && !calendar.connected
                ? calendar.connectUrl
                : null,
          },
        });
      }),
    },
  },
});
