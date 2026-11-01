import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  type Attendee,
  folders,
  meetingFolders,
  meetings,
  notes,
  shareLinks,
  transcriptSegments,
} from "@/db/schema";
import { folderVisibleTo, meetingOwnedBy, meetingVisibleTo } from "./access";
import { getTemplate, resolveTemplate } from "./templates";
import type { Viewer } from "./viewer";

const attendeeInput = z
  .object({
    email: z.string().max(320).nullable().optional(),
    name: z.string().max(255).nullable().optional(),
    self: z.boolean().optional(),
  })
  .strict();

export const createMeetingInput = z
  .object({
    title: z.string().trim().min(1).max(255),
    startsAt: z.string().datetime({ offset: true }).optional(),
    calendarEventId: z.string().max(255).optional(),
    attendees: z.array(attendeeInput).max(200).optional(),
  })
  .strict();

export const updateMeetingInput = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    visibility: z.enum(["private", "team"]).optional(),
  })
  .strict();

const segmentInput = z
  .object({
    seq: z.number().int().min(0),
    startedMs: z.number().int().min(0),
    endedMs: z.number().int().min(0),
    speaker: z.enum(["me", "them"]).nullable().optional(),
    text: z.string().max(10_000),
  })
  .strict();
const segmentList = z.array(segmentInput).min(1).max(500);
/** A bare array, or `{ segments: [...] }`. */
export const appendSegmentsInput = z
  .union([segmentList, z.object({ segments: segmentList }).strict()])
  .transform((input) => (Array.isArray(input) ? { segments: input } : input));

interface MeetingRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  status: "recording" | "processing" | "done" | "failed";
  visibility: "private" | "team";
  ownerUserId: string;
  ownerEmail: string | null;
  attendeeCount: number;
  mine: boolean;
}

export interface Segment {
  seq: number;
  startedMs: number;
  endedMs: number;
  speaker: "me" | "them" | null;
  text: string;
}

interface MeetingDetail extends MeetingRow {
  attendees: Attendee[];
  folders: { id: string; name: string; space: "private" | "team" }[];
  /** The template the notes use, and whether it was chosen on the meeting. */
  template: { id: string; name: string; chosen: boolean };
  segments: Segment[];
  notes: { markdown: string; model: string; generatedAt: string } | null;
  shareLinks: { id: string; createdAt: string }[];
}

const shown = {
  id: meetings.id,
  title: meetings.title,
  startsAt: meetings.startsAt,
  endsAt: meetings.endsAt,
  status: meetings.status,
  visibility: meetings.visibility,
  ownerUserId: meetings.ownerUserId,
  ownerEmail: meetings.ownerEmail,
  attendees: meetings.attendees,
};

const visibleTo = meetingVisibleTo;
const owned = meetingOwnedBy;

function withMine(
  viewer: Viewer,
  {
    attendees,
    ...row
  }: Omit<MeetingRow, "mine" | "attendeeCount"> & {
    attendees: Attendee[] | null;
  },
): MeetingRow {
  return {
    ...row,
    attendeeCount: attendees?.length ?? 0,
    mine: row.ownerUserId === viewer.id,
  };
}

export const listMeetingsInput = z
  .object({
    /** Only the meetings in this folder (one the viewer can see). */
    folderId: z.string().uuid().optional(),
    /** Only team meetings other people own. */
    shared: z.boolean().optional(),
  })
  .strict();

/** The meetings a viewer may read, newest first. */
export async function listMeetings(
  viewer: Viewer,
  filter: z.infer<typeof listMeetingsInput> = {},
): Promise<MeetingRow[]> {
  const where = [visibleTo(viewer)];
  if (filter.shared) {
    where.push(
      eq(meetings.visibility, "team"),
      ne(meetings.ownerUserId, viewer.id),
    );
  }
  if (filter.folderId) {
    const inFolder = db
      .select({ id: meetingFolders.meetingId })
      .from(meetingFolders)
      .innerJoin(folders, eq(folders.id, meetingFolders.folderId))
      .where(
        and(
          eq(meetingFolders.folderId, filter.folderId),
          folderVisibleTo(viewer),
        ),
      );
    where.push(inArray(meetings.id, inFolder));
  }
  const rows = await db
    .select(shown)
    .from(meetings)
    .where(and(...where))
    .orderBy(desc(meetings.startsAt));
  return rows.map((row) => withMine(viewer, row));
}

export async function createMeeting(
  viewer: Viewer & { email?: string },
  input: z.infer<typeof createMeetingInput>,
): Promise<MeetingRow> {
  const [row] = await db
    .insert(meetings)
    .values({
      id: crypto.randomUUID(),
      orgId: viewer.orgId,
      ownerUserId: viewer.id,
      ownerEmail: viewer.email ?? null,
      title: input.title,
      startsAt: input.startsAt ?? new Date().toISOString(),
      calendarEventId: input.calendarEventId ?? null,
      attendees:
        input.attendees?.map((attendee) => ({
          email: attendee.email ?? null,
          name: attendee.name ?? null,
          self: attendee.self === true,
        })) ?? null,
    })
    .returning(shown);
  return withMine(viewer, row!);
}

/** The meeting with its transcript and notes, or null when the viewer may not read it. */
export async function getMeeting(
  viewer: Viewer,
  id: string,
): Promise<MeetingDetail | null> {
  const [found] = await db
    .select({ ...shown, templateId: meetings.templateId })
    .from(meetings)
    .where(and(eq(meetings.id, id), visibleTo(viewer)));
  if (!found) return null;
  const { templateId: chosenId, ...row } = found;
  const detail = await loadDetail(row.id);
  const [filedIn, template] = await Promise.all([
    db
      .select({ id: folders.id, name: folders.name, space: folders.space })
      .from(meetingFolders)
      .innerJoin(folders, eq(folders.id, meetingFolders.folderId))
      .where(and(eq(meetingFolders.meetingId, row.id), folderVisibleTo(viewer)))
      .orderBy(asc(meetingFolders.addedAt)),
    resolveTemplate(row.id),
  ]);
  return {
    ...withMine(viewer, row),
    attendees: row.attendees ?? [],
    folders: filedIn,
    template: {
      id: template.id,
      name: template.name,
      chosen: chosenId === template.id,
    },
    ...detail,
    shareLinks:
      row.ownerUserId === viewer.id
        ? await db
            .select({ id: shareLinks.id, createdAt: shareLinks.createdAt })
            .from(shareLinks)
            .where(
              and(
                eq(shareLinks.meetingId, row.id),
                isNull(shareLinks.revokedAt),
              ),
            )
        : [],
  };
}

async function loadDetail(meetingId: string) {
  const segments = await db
    .select({
      seq: transcriptSegments.seq,
      startedMs: transcriptSegments.startedMs,
      endedMs: transcriptSegments.endedMs,
      speaker: transcriptSegments.speaker,
      text: transcriptSegments.text,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.seq));
  const [note] = await db
    .select({
      markdown: notes.markdown,
      model: notes.model,
      generatedAt: notes.generatedAt,
    })
    .from(notes)
    .where(eq(notes.meetingId, meetingId));
  return { segments, notes: note ?? null };
}

/**
 * Change title or visibility; null when no meeting of this owner has the id.
 * Making a meeting private takes it out of team folders, which share
 * everything in them.
 */
export async function updateMeeting(
  viewer: Viewer,
  id: string,
  change: z.infer<typeof updateMeetingInput>,
): Promise<MeetingRow | null> {
  const [row] = await db
    .update(meetings)
    .set({ ...change, updatedAt: new Date().toISOString() })
    .where(owned(viewer, id))
    .returning(shown);
  if (!row) return null;
  if (change.visibility === "private") {
    const teamFolders = db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.space, "team"));
    await db
      .delete(meetingFolders)
      .where(
        and(
          eq(meetingFolders.meetingId, id),
          inArray(meetingFolders.folderId, teamFolders),
        ),
      );
  }
  return withMine(viewer, row);
}

/** Delete one of the viewer's meetings with its transcript, notes and links. */
export async function deleteMeeting(
  viewer: Viewer,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(meetings)
    .where(owned(viewer, id))
    .returning({ id: meetings.id });
  return deleted.length > 0;
}

/**
 * Choose the meeting's template and mark it for rewriting: the owner's
 * finished (or failed) meeting, with a template the owner may use. The
 * caller then runs generateNotes. Null when not allowed.
 */
export async function rewriteWithTemplate(
  viewer: Viewer,
  id: string,
  templateId: string,
): Promise<MeetingRow | null> {
  if (!(await getTemplate(viewer, templateId))) return null;
  const [row] = await db
    .update(meetings)
    .set({
      templateId,
      status: "processing",
      updatedAt: new Date().toISOString(),
    })
    .where(and(owned(viewer, id), inArray(meetings.status, ["done", "failed"])))
    .returning(shown);
  return row ? withMine(viewer, row) : null;
}

/**
 * Choose the template while the meeting is still recording: the notes are
 * written with it when it ends. Null when not allowed.
 */
export async function chooseTemplate(
  viewer: Viewer,
  id: string,
  templateId: string | null,
): Promise<boolean> {
  if (templateId && !(await getTemplate(viewer, templateId))) return false;
  const updated = await db
    .update(meetings)
    .set({ templateId, updatedAt: new Date().toISOString() })
    .where(and(owned(viewer, id), eq(meetings.status, "recording")))
    .returning({ id: meetings.id });
  return updated.length > 0;
}

/** Append transcript turns; false when the owner has no such meeting. */
export async function appendSegments(
  viewer: Viewer,
  id: string,
  input: z.infer<typeof appendSegmentsInput>,
): Promise<boolean> {
  const [row] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(owned(viewer, id));
  if (!row) return false;
  await db
    .insert(transcriptSegments)
    .values(
      input.segments.map((segment) => ({
        id: crypto.randomUUID(),
        meetingId: id,
        seq: segment.seq,
        startedMs: segment.startedMs,
        endedMs: segment.endedMs,
        speaker: segment.speaker ?? null,
        text: segment.text,
      })),
    )
    .onConflictDoNothing();
  return true;
}

/** Stop recording: the meeting is `processing` until the notes are written. */
export async function finishMeeting(
  viewer: Viewer,
  id: string,
): Promise<MeetingRow | null> {
  const endedAt = new Date().toISOString();
  const [row] = await db
    .update(meetings)
    .set({ status: "processing", endsAt: endedAt, updatedAt: endedAt })
    .where(and(owned(viewer, id), eq(meetings.status, "recording")))
    .returning(shown);
  return row ? withMine(viewer, row) : null;
}

/** The transcript as one text, with speakers, for the notes prompt. */
export async function transcriptText(meetingId: string): Promise<string> {
  const rows = await db
    .select({
      speaker: transcriptSegments.speaker,
      text: transcriptSegments.text,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.seq));
  return rows
    .map((row) => (row.speaker ? `${row.speaker}: ${row.text}` : row.text))
    .join("\n");
}

/**
 * Save the notes and pin the template they were written with, so a later
 * change to a folder's or the owner's default doesn't relabel them.
 */
export async function saveNotes(
  meetingId: string,
  markdown: string,
  model: string,
  templateId?: string,
): Promise<void> {
  await db
    .insert(notes)
    .values({ meetingId, markdown, model })
    .onConflictDoUpdate({
      target: notes.meetingId,
      set: { markdown, model, generatedAt: sql`(current_timestamp)` },
    });
  await db
    .update(meetings)
    .set({
      status: "done",
      ...(templateId ? { templateId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetings.id, meetingId));
}

export async function markFailed(meetingId: string): Promise<void> {
  await db
    .update(meetings)
    .set({ status: "failed", updatedAt: new Date().toISOString() })
    .where(and(eq(meetings.id, meetingId), eq(meetings.status, "processing")));
}

function shareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** A new public link for the owner's meeting, or null. */
export async function createShareLink(
  viewer: Viewer,
  meetingId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(owned(viewer, meetingId));
  if (!row) return null;
  const id = shareToken();
  await db.insert(shareLinks).values({ id, meetingId, createdBy: viewer.id });
  return { id };
}

/** Revoke one of the owner's links; false when there is no such live link. */
export async function revokeShareLink(
  viewer: Viewer,
  meetingId: string,
  linkId: string,
): Promise<boolean> {
  const ownedIds = db
    .select({ id: meetings.id })
    .from(meetings)
    .where(owned(viewer, meetingId));
  const revoked = await db
    .update(shareLinks)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(shareLinks.id, linkId),
        inArray(shareLinks.meetingId, ownedIds),
        isNull(shareLinks.revokedAt),
      ),
    )
    .returning({ id: shareLinks.id });
  return revoked.length > 0;
}

/** What a public link shows, or null for an unknown or revoked token. */
export async function getSharedMeeting(token: string): Promise<{
  title: string;
  startsAt: string;
  segments: Segment[];
  notes: { markdown: string } | null;
} | null> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const [row] = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startsAt: meetings.startsAt,
    })
    .from(shareLinks)
    .innerJoin(meetings, eq(meetings.id, shareLinks.meetingId))
    .where(and(eq(shareLinks.id, token), isNull(shareLinks.revokedAt)));
  if (!row) return null;
  const detail = await loadDetail(row.id);
  return {
    title: row.title,
    startsAt: row.startsAt,
    segments: detail.segments,
    notes: detail.notes ? { markdown: detail.notes.markdown } : null,
  };
}

/** The viewer's meetings recorded from these calendar events, by event id. */
export async function meetingsForEvents(
  viewer: Viewer,
  eventIds: string[],
): Promise<Record<string, string>> {
  if (eventIds.length === 0) return {};
  const rows = await db
    .select({ id: meetings.id, eventId: meetings.calendarEventId })
    .from(meetings)
    .where(
      and(
        eq(meetings.orgId, viewer.orgId),
        eq(meetings.ownerUserId, viewer.id),
        inArray(meetings.calendarEventId, eventIds),
      ),
    )
    .orderBy(asc(meetings.startsAt));
  return Object.fromEntries(rows.map((row) => [row.eventId!, row.id]));
}
