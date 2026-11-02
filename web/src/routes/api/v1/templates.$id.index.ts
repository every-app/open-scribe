import { createFileRoute } from "@tanstack/react-router";
import { api, json, notFound, readJson, requireApiUser } from "@/server/api";
import {
  deleteTemplate,
  getTemplate,
  patchTemplate,
  updateTemplateInput,
} from "@/server/templates";

export const Route = createFileRoute("/api/v1/templates/$id/")({
  server: {
    handlers: {
      GET: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const template = await getTemplate(user, params.id!);
        return template ? json({ template }) : notFound();
      }),
      // Only the owner edits a template (built-ins are no one's).
      PATCH: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const change = await readJson(request, updateTemplateInput);
        const template = await patchTemplate(user, params.id!, change);
        return template ? json({ template }) : notFound();
      }),
      DELETE: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        return (await deleteTemplate(user, params.id!))
          ? json({ ok: true })
          : notFound();
      }),
    },
  },
});
