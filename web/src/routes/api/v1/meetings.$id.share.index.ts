import { createFileRoute } from "@tanstack/react-router";
import { api, json, requireApiUser } from "@/server/api";
import { createShareLink } from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/$id/share/")({
  server: {
    handlers: {
      POST: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const link = await createShareLink(user, params.id!);
        if (!link) return json({ error: "not_found" }, 404);
        const url = new URL(`/s/${link.id}`, request.url).toString();
        return json({ link: { id: link.id, url } }, 201);
      }),
    },
  },
});
