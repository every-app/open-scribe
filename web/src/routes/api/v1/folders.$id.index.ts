import { updateFolderInput } from "@/api/contract";
import { createFileRoute } from "@tanstack/react-router";
import {
  api,
  apiError,
  json,
  notFound,
  readJson,
  requireApiUser,
} from "@/server/api";
import { deleteFolder, getFolder, updateFolder } from "@/server/folders";

export const Route = createFileRoute("/api/v1/folders/$id/")({
  server: {
    handlers: {
      // Rename, or set the default template (null clears it). Anyone on the
      // team may change a team folder; a private one is its owner's.
      PATCH: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        const change = await readJson(request, updateFolderInput);
        if (!(await getFolder(user, params.id!))) return notFound();
        const folder = await updateFolder(user, params.id!, change);
        if (!folder) {
          return apiError(
            400,
            "template_unavailable",
            "A team folder's template must be one the whole team can use.",
          );
        }
        return json({ folder });
      }),
      // The meetings stay; only the filing goes.
      DELETE: api(async ({ request, params }) => {
        const user = await requireApiUser(request);
        return (await deleteFolder(user, params.id!))
          ? json({ ok: true })
          : notFound();
      }),
    },
  },
});
