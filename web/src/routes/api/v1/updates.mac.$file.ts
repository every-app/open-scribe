import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { api, requireApiUser } from "@/server/api";
import { serveUpdateFile } from "@/server/updates";

// The desktop app's update feed (electron-updater's generic provider, with
// the member's bearer token): any signed-in member of the organization may
// download a release. Only allowlisted names under mac/ are served.
const handler = api(async ({ request, params }) => {
  await requireApiUser(request);
  return serveUpdateFile(env.UPDATES, params.file ?? "", request);
});

export const Route = createFileRoute("/api/v1/updates/mac/$file")({
  server: { handlers: { GET: handler, HEAD: handler } },
});
