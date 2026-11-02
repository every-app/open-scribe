import { appendSegmentsInput } from "@/api/contract";
import { createFileRoute } from "@tanstack/react-router";
import { api, json, readJson, requireApiUser } from "@/server/api";
import { appendSegments } from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/$id/segments")({
  server: {
    handlers: {
      POST: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const input = await readJson(request, appendSegmentsInput);
        const ok = await appendSegments(user, params.id!, input);
        return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
      }),
    },
  },
});
