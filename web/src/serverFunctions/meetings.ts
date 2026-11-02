import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { z } from "zod";
import * as meetings from "@/server/meetings";
import { applyTemplate } from "@/server/notes";
import {
  listMeetingsInput,
  templateIdInput,
  updateMeetingInput,
} from "@/api/contract";

const idInput = z.object({ id: z.string().uuid() }).strict();

export const listMeetings = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => listMeetingsInput.parse(data ?? {}))
  .handler(({ data, context: { user } }) => meetings.listMeetings(user, data));

export const getMeeting = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => idInput.parse(data))
  .handler(({ data, context: { user } }) => meetings.getMeeting(user, data.id));

export const updateMeeting = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    idInput.extend({ change: updateMeetingInput }).parse(data),
  )
  .handler(({ data, context: { user } }) =>
    meetings.updateMeeting(user, data.id, data.change),
  );

export const deleteMeeting = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => idInput.parse(data))
  .handler(({ data, context: { user } }) =>
    meetings.deleteMeeting(user, data.id),
  );

/**
 * Pick the meeting's template. A finished meeting's notes are rewritten
 * with it in the background; a recording one uses it when it ends.
 */
export const setMeetingTemplate = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    idInput.extend({ templateId: templateIdInput }).parse(data),
  )
  .handler(async ({ data, context: { user } }) => {
    const applied = await applyTemplate(
      getRequest(),
      user,
      data.id,
      data.templateId,
    );
    if (!applied) throw new Error("You can't change this meeting's template.");
    return applied;
  });

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
