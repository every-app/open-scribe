import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";
import { api, json, requireApiUser } from "@/server/api";
import { finishMeeting } from "@/server/meetings";
import { generateNotes } from "@/server/notes";

export const Route = createFileRoute("/api/v1/meetings/$id/finish")({
  server: {
    handlers: {
      POST: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const meeting = await finishMeeting(user, params.id!);
        if (!meeting) return json({ error: "not_found" }, 404);
        waitUntil(generateNotes(request, meeting.id, meeting.title));
        return json({ meeting });
      }),
    },
  },
});
