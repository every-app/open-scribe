import { createFileRoute } from "@tanstack/react-router";
import { api, json, notFound, readJson, requireApiUser } from "@/server/api";
import { saveJottings, saveJottingsInput } from "@/server/meetings";

export const Route = createFileRoute("/api/v1/meetings/$id/jottings")({
  server: {
    handlers: {
      // The owner's notepad. Debounce-friendly: send the whole text with the
      // time it was typed; an older save than the stored one is ignored
      // (`applied: false`) and the answer carries what is stored.
      PUT: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const input = await readJson(request, saveJottingsInput);
        const saved = await saveJottings(user, params.id!, input);
        return saved ? json(saved) : notFound();
      }),
    },
  },
});
