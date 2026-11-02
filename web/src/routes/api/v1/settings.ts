import { updateSettingsInput } from "@/api/contract";
import { createFileRoute } from "@tanstack/react-router";
import { api, apiError, json, readJson, requireApiUser } from "@/server/api";
import { getSettings, updateSettings } from "@/server/settings";

export const Route = createFileRoute("/api/v1/settings")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        return json({ settings: await getSettings(user) });
      }),
      PATCH: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const change = await readJson(request, updateSettingsInput);
        const settings = await updateSettings(user, change);
        return settings
          ? json({ settings })
          : apiError(400, "unknown_template", "No template with that id.");
      }),
    },
  },
});
