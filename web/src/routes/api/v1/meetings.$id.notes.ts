import { createFileRoute } from "@tanstack/react-router";
import {
  api,
  apiError,
  json,
  notFound,
  readJson,
  requireApiUser,
} from "@/server/api";
import { editNotes, editNotesInput } from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/$id/notes")({
  server: {
    handlers: {
      // The owner's edit of the notes (sets editedAt). A template rewrite
      // later replaces it.
      PUT: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const { markdown } = await readJson(request, editNotesInput);
        const notes = await editNotes(user, params.id!, markdown);
        if (notes === "busy") {
          return apiError(
            409,
            "busy",
            "The notes are written when the meeting ends; jot in the notepad until then.",
          );
        }
        return notes ? json({ notes }) : notFound();
      }),
    },
  },
});
