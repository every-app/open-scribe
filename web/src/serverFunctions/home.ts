import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { gatewayUrl } from "@every-app/sdk/server";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { env } from "cloudflare:workers";
import { calendarStatus } from "@/server/calendar";

/** The first screen's facts: who is signed in, Google, and the way back. */
export const getHome = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context: { user } }) => {
    const request = getRequest();
    return {
      user: { email: user.email, orgName: user.orgName ?? "your workspace" },
      calendar: await calendarStatus(request, new URL(request.url).origin),
      appUrl: new URL(request.url).origin,
      launcher: gatewayUrl(env),
      tokensUrl: gatewayUrl(env, "/admin/tokens"),
    };
  });
