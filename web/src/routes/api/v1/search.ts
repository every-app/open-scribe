import { createFileRoute } from "@tanstack/react-router";
import { searchQuery } from "@/api/contract";
import { api, apiError, json, readQuery, requireApiUser } from "@/server/api";
import { InvalidSearchCursor, searchMeetings } from "@/server/search";

export const Route = createFileRoute("/api/v1/search")({
  server: {
    handlers: {
      // ?q=&limit=&cursor=: the meetings the caller can read that match,
      // best first, each with a plain-text snippet and its match ranges.
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const query = readQuery(request, searchQuery);
        try {
          return json(await searchMeetings(user, query));
        } catch (error) {
          if (error instanceof InvalidSearchCursor) {
            return apiError(400, "invalid_cursor");
          }
          throw error;
        }
      }),
    },
  },
});
