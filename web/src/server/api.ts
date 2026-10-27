import { getEveryAppUser, type EveryAppUser } from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import type { z } from "zod";

/**
 * The Mac app's API: plain JSON routes under /api/v1, each private, so the
 * Gateway admits only a signed-in member or a Full-access personal access
 * token (`Authorization: Bearer epat_…`). The identity comes from the
 * Gateway's header through the SDK, never from anything the client sent.
 */
export async function requireApiUser(request: Request): Promise<EveryAppUser> {
  const user = await getEveryAppUser(request, env);
  if (!user) throw json({ error: "unauthenticated" }, 401);
  return user;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** The body as JSON, checked; a bad one is a 400 the handler throws. */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw json({ error: "invalid_json" }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  return parsed.data;
}

type Handler = (ctx: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

/** A thrown Response is the answer; anything else is a 500 that names nothing. */
export function api(handler: Handler): Handler {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("[api]", ctx.request.method, ctx.request.url, error);
      return json({ error: "internal_error" }, 500);
    }
  };
}
