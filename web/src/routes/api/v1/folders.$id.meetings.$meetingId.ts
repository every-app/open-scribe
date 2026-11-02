import { createFileRoute } from "@tanstack/react-router";
import { api, apiError, json, notFound, requireApiUser } from "@/server/api";
import { addToFolder, getFolder, removeFromFolder } from "@/server/folders";
import { getMeeting } from "@/server/meetings";

export const Route = createFileRoute("/api/v1/folders/$id/meetings/$meetingId")(
  {
    server: {
      handlers: {
        // File a meeting. In a team folder that shares it with the team, which
        // only the owner may do to a private meeting (`shared: true` says it
        // happened).
        PUT: api(async ({ request, params }) => {
          const user = await requireApiUser(request);
          const [folder, meeting] = await Promise.all([
            getFolder(user, params.id!),
            getMeeting(user, params.meetingId!),
          ]);
          if (!folder || !meeting) return notFound();
          const added = await addToFolder(user, folder.id, meeting.id);
          if (!added) {
            return apiError(
              403,
              "forbidden",
              "Only its owner can add a private meeting to a team folder.",
            );
          }
          return json(added);
        }),
        // Unfile; the meeting stays as visible as it was.
        DELETE: api(async ({ request, params }) => {
          const user = await requireApiUser(request);
          return (await removeFromFolder(user, params.id!, params.meetingId!))
            ? json({ ok: true })
            : notFound();
        }),
      },
    },
  },
);
