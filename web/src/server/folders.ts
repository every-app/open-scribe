import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type {
  createFolderInput,
  Folder,
  updateFolderInput,
} from "@/api/contract";
import { db } from "@/db";
import { folders, meetingFolders, meetings } from "@/db/schema";
import { folderVisibleTo, meetingVisibleTo } from "./access";
import { getTemplate } from "./templates";
import type { Viewer } from "./viewer";

const shown = {
  id: folders.id,
  name: folders.name,
  space: folders.space,
  defaultTemplateId: folders.defaultTemplateId,
};

/** The viewer's private folders and the team's, by name. */
export async function listFolders(viewer: Viewer): Promise<Folder[]> {
  return db
    .select(shown)
    .from(folders)
    .where(folderVisibleTo(viewer))
    .orderBy(asc(folders.name));
}

/** listFolders, each with how many of its meetings the viewer can read. */
export async function listFoldersWithCounts(
  viewer: Viewer,
): Promise<(Folder & { meetingCount: number })[]> {
  const list = await listFolders(viewer);
  if (list.length === 0) return [];
  const counts = await db
    .select({ folderId: meetingFolders.folderId, n: count() })
    .from(meetingFolders)
    .innerJoin(meetings, eq(meetings.id, meetingFolders.meetingId))
    .where(
      and(
        inArray(
          meetingFolders.folderId,
          list.map((folder) => folder.id),
        ),
        meetingVisibleTo(viewer),
      ),
    )
    .groupBy(meetingFolders.folderId);
  const byFolder = new Map(counts.map((row) => [row.folderId, row.n]));
  return list.map((folder) => ({
    ...folder,
    meetingCount: byFolder.get(folder.id) ?? 0,
  }));
}

export async function getFolder(
  viewer: Viewer,
  id: string,
): Promise<Folder | null> {
  const [row] = await db
    .select(shown)
    .from(folders)
    .where(and(eq(folders.id, id), folderVisibleTo(viewer)));
  return row ?? null;
}

export async function createFolder(
  viewer: Viewer,
  input: z.infer<typeof createFolderInput>,
): Promise<Folder> {
  const [row] = await db
    .insert(folders)
    .values({
      id: crypto.randomUUID(),
      orgId: viewer.orgId,
      ownerUserId: viewer.id,
      ...input,
    })
    .returning(shown);
  return row!;
}

/** Rename, or set the default template; null when the viewer can't. */
export async function updateFolder(
  viewer: Viewer,
  id: string,
  change: z.infer<typeof updateFolderInput>,
): Promise<Folder | null> {
  if (change.defaultTemplateId) {
    const template = await getTemplate(viewer, change.defaultTemplateId);
    if (!template) return null;
    // A team folder's template is for everyone's notes in it, so it must be
    // one the whole team may use, not someone's private one.
    if (template.visibility !== "team") {
      const folder = await getFolder(viewer, id);
      if (!folder || folder.space === "team") return null;
    }
  }
  const [row] = await db
    .update(folders)
    .set({ ...change, updatedAt: new Date().toISOString() })
    .where(and(eq(folders.id, id), folderVisibleTo(viewer)))
    .returning(shown);
  return row ?? null;
}

/** Delete a folder; its meetings stay, only the filing goes. */
export async function deleteFolder(
  viewer: Viewer,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(folders)
    .where(and(eq(folders.id, id), folderVisibleTo(viewer)))
    .returning({ id: folders.id });
  return deleted.length > 0;
}

/**
 * File a meeting in a folder. A private folder takes any meeting the viewer
 * can read. A team folder shares what's in it: the owner of a private
 * meeting may file it there (it becomes visible to the team); anyone may
 * file a meeting the team can already see. Null when not allowed.
 */
export async function addToFolder(
  viewer: Viewer,
  folderId: string,
  meetingId: string,
): Promise<{ shared: boolean } | null> {
  const folder = await getFolder(viewer, folderId);
  if (!folder) return null;
  const [meeting] = await db
    .select({
      ownerUserId: meetings.ownerUserId,
      visibility: meetings.visibility,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), meetingVisibleTo(viewer)));
  if (!meeting) return null;
  let shared = false;
  if (folder.space === "team" && meeting.visibility === "private") {
    if (meeting.ownerUserId !== viewer.id) return null;
    await db
      .update(meetings)
      .set({ visibility: "team", updatedAt: new Date().toISOString() })
      .where(eq(meetings.id, meetingId));
    shared = true;
  }
  await db
    .insert(meetingFolders)
    .values({ meetingId, folderId, addedBy: viewer.id })
    .onConflictDoNothing();
  return { shared };
}

/** Take a meeting out of a folder; it stays as visible as it was. */
export async function removeFromFolder(
  viewer: Viewer,
  folderId: string,
  meetingId: string,
): Promise<boolean> {
  if (!(await getFolder(viewer, folderId))) return false;
  const removed = await db
    .delete(meetingFolders)
    .where(
      and(
        eq(meetingFolders.folderId, folderId),
        eq(meetingFolders.meetingId, meetingId),
      ),
    )
    .returning({ id: meetingFolders.meetingId });
  return removed.length > 0;
}
