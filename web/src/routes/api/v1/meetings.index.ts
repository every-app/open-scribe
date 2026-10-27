import { createFileRoute } from "@tanstack/react-router";
import { api, json, readJson, requireApiUser } from "@/server/api";
import {
  createMeeting,
  createMeetingInput,
  listMeetings,
} from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        return json({ meetings: await listMeetings(user) });
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
