import { createFileRoute } from "@tanstack/react-router";
import { api, json, readJson, requireApiUser } from "@/server/api";
import {
  createFolder,
  createFolderInput,
  listFoldersWithCounts,
} from "@/server/folders";

export const Route = createFileRoute("/api/v1/folders/")({
  server: {
    handlers: {
      GET: api(async ({ request }) => {
        const user = await requireApiUser(request);
        return json({ folders: await listFoldersWithCounts(user) });
      }),
      POST: api(async ({ request }) => {
        const user = await requireApiUser(request);
        const input = await readJson(request, createFolderInput);
        const folder = await createFolder(user, input);
        return json({ folder: { ...folder, meetingCount: 0 } }, 201);
      }),
    },
  },
});
