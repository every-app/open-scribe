import { createFileRoute } from "@tanstack/react-router";
import { api, json, readJson, requireApiUser } from "@/server/api";
import { getMeeting } from "@/server/meetings";
import {
  mintTranscriptionToken,
  TranscriptionRefused,
  transcriptionTokenInput,
} from "@/server/transcription";

export const Route = createFileRoute(
  "/api/v1/meetings/$id/transcription-token",
)({
  server: {
    handlers: {
      POST: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const meeting = await getMeeting(user, params.id!);
        if (!meeting?.mine || meeting.status !== "recording") {
          return json({ error: "not_found" }, 404);
        }
        const input = await readJson(request, transcriptionTokenInput);
        try {
          return json(await mintTranscriptionToken(request, input));
        } catch (error) {
          if (error instanceof TranscriptionRefused) {
            return json(
              { error: error.code, message: error.message },
              error.status,
            );
          }
          throw error;
        }
      }),
    },
  },
});
