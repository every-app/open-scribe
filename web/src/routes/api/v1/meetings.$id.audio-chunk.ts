import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { api, json, requireApiUser } from "@/server/api";
import { appendSegments, getMeeting } from "@/server/meetings";
import {
  MAX_CHUNK_BYTES,
  transcribeChunk,
  TranscriptionRefused,
} from "@/server/transcription";

const fields = z
  .object({
    seq: z.coerce.number().int().min(0),
    startedMs: z.coerce.number().int().min(0),
    endedMs: z.coerce.number().int().min(0),
    speaker: z.enum(["me", "them"]).optional(),
    language: z.string().min(2).max(10).optional(),
  })
  .strict();

// The chunked fallback: multipart `file` (WAV, ≤ 30 s) plus the segment's
// fields. The audio goes to OpenAI through the Gateway and is never stored.
export const Route = createFileRoute("/api/v1/meetings/$id/audio-chunk")({
  server: {
    handlers: {
      POST: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const meeting = await getMeeting(user, params.id!);
        if (!meeting?.mine || meeting.status !== "recording") {
          return json({ error: "not_found" }, 404);
        }
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return json({ error: "invalid_form" }, 400);
        }
        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) {
          return json(
            { error: "invalid_body", message: "file is required" },
            400,
          );
        }
        if (file.size > MAX_CHUNK_BYTES) {
          return json({ error: "chunk_too_large" }, 413);
        }
        const parsed = fields.safeParse(
          Object.fromEntries(
            [...form.entries()].filter(([name]) => name !== "file"),
          ),
        );
        if (!parsed.success) {
          return json(
            { error: "invalid_body", issues: parsed.error.issues },
            400,
          );
        }
        const { language, ...segment } = parsed.data;
        try {
          const text = await transcribeChunk(request, file, language);
          const stored = { ...segment, speaker: segment.speaker ?? null, text };
          if (text) {
            await appendSegments(user, meeting.id, { segments: [stored] });
          }
          return json({ segment: stored });
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
