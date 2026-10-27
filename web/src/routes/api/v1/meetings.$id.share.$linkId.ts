import { createFileRoute } from "@tanstack/react-router";
import { api, json, requireApiUser } from "@/server/api";
import { revokeShareLink } from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/$id/share/$linkId")({
  server: {
    handlers: {
      DELETE: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const ok = await revokeShareLink(user, params.id!, params.linkId!);
        return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
      }),
    },
  },
});
