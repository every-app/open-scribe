import { createFileRoute } from "@tanstack/react-router";
import { api, json, readJson, requireApiUser } from "@/server/api";
import {
  getMeeting,
  updateMeeting,
  updateMeetingInput,
} from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/$id/")({
  server: {
    handlers: {
      GET: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const meeting = await getMeeting(user, params.id!);
        return meeting ? json({ meeting }) : json({ error: "not_found" }, 404);
      }),
      PATCH: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const change = await readJson(request, updateMeetingInput);
        const meeting = await updateMeeting(user, params.id!, change);
        return meeting ? json({ meeting }) : json({ error: "not_found" }, 404);
      }),
    },
  },
});
