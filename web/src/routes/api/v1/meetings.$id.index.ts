import { createFileRoute } from "@tanstack/react-router";
import {
  api,
  apiError,
  json,
  notFound,
  readJson,
  requireApiUser,
} from "@/server/api";
import {
  deleteMeeting,
  getMeeting,
  updateMeeting,
  updateMeetingInput,
} from "@/server/meetings";
import { applyTemplate } from "@/server/notes";
import { getTemplate, templateIdInput } from "@/server/templates";

const patchInput = updateMeetingInput.extend({
  /**
   * The template: a finished meeting's notes are rewritten with it in the
   * background (`rewriting: true`); a recording one uses it when it ends.
   * Null (while recording) goes back to the folder's or the owner's default.
   */
  templateId: templateIdInput.nullable().optional(),
});

export const Route = createFileRoute("/api/v1/meetings/$id/")({
  server: {
    handlers: {
      GET: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const meeting = await getMeeting(user, params.id!);
        return meeting ? json({ meeting }) : notFound();
      }),
      // Owner only. Answers the whole meeting as it is afterwards.
      PATCH: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const { templateId, ...change } = await readJson(request, patchInput);
        const current = await getMeeting(user, params.id!);
        if (!current?.mine) return notFound();
        if (templateId && !(await getTemplate(user, templateId))) {
          return apiError(400, "unknown_template", "No template with that id.");
        }
        if (templateId === null && current.status !== "recording") {
          return apiError(
            409,
            "busy",
            "A finished meeting's template can be changed, not cleared.",
          );
        }
        if (current.status === "processing" && templateId !== undefined) {
          return apiError(409, "busy", "The notes are being written.");
        }
        if (change.title !== undefined || change.visibility !== undefined) {
          await updateMeeting(user, current.id, change);
        }
        let rewriting = false;
        if (templateId !== undefined) {
          const applied = await applyTemplate(
            request,
            user,
            current.id,
            templateId,
          );
          if (!applied) {
            return apiError(409, "busy", "The template can't change now.");
          }
          rewriting = applied.rewriting;
        }
        return json({ meeting: await getMeeting(user, current.id), rewriting });
      }),
      // Owner only: the meeting with its transcript, notes, jottings and links.
      DELETE: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        return (await deleteMeeting(user, params.id!))
          ? json({ ok: true })
          : notFound();
      }),
    },
  },
});
