import { createFileRoute } from "@tanstack/react-router";
import { api, json, notFound, requireApiUser } from "@/server/api";
import { duplicateTemplate } from "@/server/templates";

export const Route = createFileRoute("/api/v1/templates/$id/duplicate")({
  server: {
    handlers: {
      // A private copy of any template the person may use.
      POST: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const template = await duplicateTemplate(user, params.id!);
        return template ? json({ template }, 201) : notFound();
      }),
    },
  },
});
