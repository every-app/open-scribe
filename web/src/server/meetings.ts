import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { z } from "zod";
import {
  type appendSegmentsInput,
  type Attendee,
  type createMeetingInput,
  type Jottings,
  type listMeetingsInput,
  type MeetingDetail,
  type MeetingRow,
  type saveJottingsInput,
  type Segment,
  type updateMeetingInput,
} from "@/api/contract";
import { db } from "@/db";
import {
  folders,
  jottings,
  meetingFolders,
  meetings,
  notes,
  shareLinks,
  transcriptSegments,
} from "@/db/schema";
import { folderVisibleTo, meetingOwnedBy, meetingVisibleTo } from "./access";
import { getTemplate, resolveTemplate } from "./templates";
import type { Viewer } from "./viewer";

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

type ListFilter = z.infer<typeof listMeetingsInput>;

/** A page boundary: the last row's start and id, opaque to the client. */
function encodeCursor(row: { startsAt: string; id: string }): string {
  return btoa(JSON.stringify([row.startsAt, row.id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(cursor: string): { startsAt: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(
      atob(cursor.replaceAll("-", "+").replaceAll("_", "/")),
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { startsAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

export class InvalidCursor extends Error {}

/**
 * The meetings a viewer may read, newest first, filtered. With `limit`,
 * `nextCursor` names where the next page starts (null on the last page).
 */
export async function listMeetingsPage(
  viewer: Viewer,
  filter: ListFilter = {},
): Promise<{ meetings: MeetingRow[]; nextCursor: string | null }> {
  const where: (SQL | undefined)[] = [visibleTo(viewer)];
  if (filter.shared) {
    where.push(
      eq(meetings.visibility, "team"),
      ne(meetings.ownerUserId, viewer.id),
    );
  }
  if (filter.mine) where.push(eq(meetings.ownerUserId, viewer.id));
  if (filter.q) {
    const pattern = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`${meetings.title} like ${pattern} escape '\\'`);
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
  if (filter.cursor) {
    const after = decodeCursor(filter.cursor);
    if (!after) throw new InvalidCursor();
    where.push(
      or(
        lt(meetings.startsAt, after.startsAt),
        and(eq(meetings.startsAt, after.startsAt), lt(meetings.id, after.id)),
      ),
    );
  }
  const query = db
    .select(shown)
    .from(meetings)
    .where(and(...where))
    .orderBy(desc(meetings.startsAt), desc(meetings.id));
  const rows = filter.limit ? await query.limit(filter.limit + 1) : await query;
  const more = filter.limit !== undefined && rows.length > filter.limit;
  const page = more ? rows.slice(0, filter.limit) : rows;
  return {
    meetings: page.map((row) => withMine(viewer, row)),
    nextCursor: more ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/** The meetings a viewer may read, newest first. */
export async function listMeetings(
  viewer: Viewer,
  filter: ListFilter = {},
): Promise<MeetingRow[]> {
  return (await listMeetingsPage(viewer, filter)).meetings;
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
    // The owner's private template stays theirs: others see that there is one.
    template:
      template.visibility === "private" && row.ownerUserId !== viewer.id
        ? { id: "", name: "Private template", chosen: false }
        : {
            id: template.id,
            name: template.name,
            chosen: chosenId === template.id,
          },
    ...detail,
    jottings: row.ownerUserId === viewer.id ? await getJottings(row.id) : null,
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
      editedAt: notes.editedAt,
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
 * Mark the meeting for rewriting with a template: the owner's finished (or
 * failed) meeting, with a template the owner may use. The caller then runs
 * generateNotes with that template, which pins it only once the notes are
 * written, so a failed rewrite leaves the earlier notes and their template.
 * Null when not allowed.
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
 *
 * Only while the meeting is `processing` (finished, or a rewrite started):
 * the owner can't edit notes then (see editNotes), so the written notes
 * never replace an edit made after the writing began. The notes go first and
 * the status flips after, so edits stay refused until both are in.
 */
export async function saveNotes(
  meetingId: string,
  markdown: string,
  model: string,
  templateId?: string,
): Promise<void> {
  const written = await db
    .insert(notes)
    .select(
      db
        .select({
          meetingId: meetings.id,
          markdown: sql<string>`${markdown}`.as("markdown"),
          model: sql<string>`${model}`.as("model"),
          generatedAt: sql<string>`(current_timestamp)`.as("generated_at"),
          editedAt: sql<string | null>`null`.as("edited_at"),
        })
        .from(meetings)
        .where(
          and(eq(meetings.id, meetingId), eq(meetings.status, "processing")),
        ),
    )
    .onConflictDoUpdate({
      target: notes.meetingId,
      // Written afresh, so no longer the person's edit.
      set: {
        markdown,
        model,
        generatedAt: sql`(current_timestamp)`,
        editedAt: null,
      },
    })
    .returning({ meetingId: notes.meetingId });
  if (written.length === 0) return;
  await db
    .update(meetings)
    .set({
      status: "done",
      ...(templateId ? { templateId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(meetings.id, meetingId), eq(meetings.status, "processing")));
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

async function getJottings(meetingId: string): Promise<Jottings | null> {
  const [row] = await db
    .select({ markdown: jottings.markdown, updatedAt: jottings.updatedAt })
    .from(jottings)
    .where(eq(jottings.meetingId, meetingId));
  return row ?? null;
}

/** The jottings as one text for the notes prompt; empty when none. */
export async function jottingsText(meetingId: string): Promise<string> {
  return (await getJottings(meetingId))?.markdown ?? "";
}

/**
 * Save the owner's notepad, last write wins by `updatedAt`. Returns what is
 * stored afterwards and whether this save is it; null when the viewer owns
 * no such meeting.
 */
export async function saveJottings(
  viewer: Viewer,
  meetingId: string,
  input: z.infer<typeof saveJottingsInput>,
): Promise<{ jottings: Jottings; applied: boolean } | null> {
  const [row] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(owned(viewer, meetingId));
  if (!row) return null;
  const now = Date.now();
  const typedAt = input.updatedAt ? Date.parse(input.updatedAt) : now;
  const updatedAt = new Date(Math.min(typedAt, now)).toISOString();
  await db
    .insert(jottings)
    .values({ meetingId, markdown: input.markdown, updatedAt })
    .onConflictDoUpdate({
      target: jottings.meetingId,
      set: { markdown: input.markdown, updatedAt },
      setWhere: sql`${jottings.updatedAt} <= ${updatedAt}`,
    });
  const stored = (await getJottings(meetingId))!;
  return {
    jottings: stored,
    applied:
      stored.updatedAt === updatedAt && stored.markdown === input.markdown,
  };
}

/**
 * The owner's edit of the notes; sets `editedAt`. Null when the viewer owns
 * no such meeting; "busy" while it records or its notes are being written,
 * since those notes are about to be replaced (jot in the notepad instead).
 *
 * The status check and the write are one statement (an upsert from a SELECT
 * of the meeting that only matches when it is done or failed), so a template
 * rewrite that starts meanwhile either comes after the edit (and replaces
 * it, as the person asked last) or refuses it; an edit never lands on notes
 * that are being rewritten.
 */
export async function editNotes(
  viewer: Viewer,
  meetingId: string,
  markdown: string,
): Promise<MeetingDetail["notes"] | "busy" | null> {
  const editedAt = new Date().toISOString();
  const written = await db
    .insert(notes)
    .select(
      db
        .select({
          meetingId: meetings.id,
          markdown: sql<string>`${markdown}`.as("markdown"),
          model: sql<string>`'manual'`.as("model"),
          generatedAt: sql<string>`(current_timestamp)`.as("generated_at"),
          editedAt: sql<string>`${editedAt}`.as("edited_at"),
        })
        .from(meetings)
        .where(
          and(
            owned(viewer, meetingId),
            inArray(meetings.status, ["done", "failed"]),
          ),
        ),
    )
    .onConflictDoUpdate({
      target: notes.meetingId,
      set: { markdown, editedAt },
    })
    .returning({ meetingId: notes.meetingId });
  if (written.length === 0) {
    const [row] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(owned(viewer, meetingId));
    return row ? "busy" : null;
  }
  const { notes: saved } = await loadDetail(meetingId);
  return saved;
}
