import { and, eq, or } from "drizzle-orm";
import { folders, meetings } from "@/db/schema";
import type { Viewer } from "./viewer";

/** The meetings a viewer may read: their own, and the organization's team ones. */
export function meetingVisibleTo(viewer: Viewer) {
  return and(
    eq(meetings.orgId, viewer.orgId),
    or(eq(meetings.ownerUserId, viewer.id), eq(meetings.visibility, "team")),
  );
}

export function meetingOwnedBy(viewer: Viewer, id: string) {
  return and(
    eq(meetings.id, id),
    eq(meetings.orgId, viewer.orgId),
    eq(meetings.ownerUserId, viewer.id),
  );
}

/**
 * The folders a viewer sees and may change: their own private ones and
 * every team folder in the organization (anyone on the team can rename one,
 * set its template, or file meetings in it).
 */
export function folderVisibleTo(viewer: Viewer) {
  return and(
    eq(folders.orgId, viewer.orgId),
    or(eq(folders.space, "team"), eq(folders.ownerUserId, viewer.id)),
  );
}
