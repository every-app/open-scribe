import { createFileRoute } from "@tanstack/react-router";
import { api, json, readJson, requireApiUser } from "@/server/api";
import {
  createTemplate,
  getDefaultTemplateId,
  listTemplates,
  saveTemplateInput,
} from "@/server/templates";

export const Route = createFileRoute("/api/v1/templates/")({
  server: {
    handlers: {
      // The built-ins, then the person's own and the team's, by name.
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const [templates, defaultTemplateId] = await Promise.all([
          listTemplates(user),
          getDefaultTemplateId(user),
        ]);
        return json({ templates, defaultTemplateId });
      }),
      POST: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const input = await readJson(request, saveTemplateInput);
        return json({ template: await createTemplate(user, input) }, 201);
      }),
    },
  },
});
