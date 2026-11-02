import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
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
  createMeetingInput,
  InvalidCursor,
  listMeetingsPage,
} from "@/server/meetings";

const flag = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1")
  .optional();

const listQuery = z
  .object({
    folderId: z.string().uuid().optional(),
    shared: flag,
    mine: flag,
    q: z.string().trim().min(1).max(200).optional(),
    cursor: z.string().max(400).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const Route = createFileRoute("/api/v1/meetings/")({
  server: {
    handlers: {
      // ?folderId=&shared=true&mine=true&q=&cursor=&limit= (default 50);
      // newest first, `nextCursor` null on the last page.
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const filter = readQuery(request, listQuery);
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
