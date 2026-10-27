import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { z } from "zod";
import * as meetings from "@/server/meetings";

const idInput = z.object({ id: z.string().uuid() }).strict();

export const listMeetings = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(({ context: { user } }) => meetings.listMeetings(user));

export const getMeeting = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => idInput.parse(data))
  .handler(({ data, context: { user } }) => meetings.getMeeting(user, data.id));

export const updateMeeting = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    idInput.extend({ change: meetings.updateMeetingInput }).parse(data),
  )
  .handler(({ data, context: { user } }) =>
    meetings.updateMeeting(user, data.id, data.change),
  );

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => idInput.parse(data))
  .handler(({ data, context: { user } }) =>
    meetings.createShareLink(user, data.id),
  );

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    idInput.extend({ linkId: z.string().min(1) }).parse(data),
  )
  .handler(({ data, context: { user } }) =>
    meetings.revokeShareLink(user, data.id, data.linkId),
  );

/** A shared page: no member needed, the token is the check. */
export const getSharedMeeting = createServerFn()
  .validator((data: unknown) =>
    z.object({ token: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) => meetings.getSharedMeeting(data.token));
