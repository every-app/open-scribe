import { createMeetingInput, listMeetingsQuery } from "@/api/contract";
import { createFileRoute } from "@tanstack/react-router";
import {
  api,
  apiError,
  json,
  readJson,
  readQuery,
  requireApiUser,
} from "@/server/api";
import {
  createMeeting,
  InvalidCursor,
  listMeetingsPage,
} from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/")({
  server: {
    handlers: {
      // ?folderId=&shared=true&mine=true&q=&cursor=&limit= (default 50);
      // newest first, `nextCursor` null on the last page.
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const filter = readQuery(request, listMeetingsQuery);
        try {
          return json(await listMeetingsPage(user, filter));
        } catch (error) {
          if (error instanceof InvalidCursor) {
            return apiError(400, "invalid_cursor");
          }
          throw error;
        }
      }),
      POST: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const input = await readJson(request, createMeetingInput);
        const meeting = await createMeeting(user, input);
        return json({ id: meeting.id, meeting }, 201);
      }),
    },
  },
});
