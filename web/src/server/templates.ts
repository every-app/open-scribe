import { and, asc, eq, or } from "drizzle-orm";
import type { z } from "zod";
import type {
  saveTemplateInput,
  Template,
  updateTemplateInput,
} from "@/api/contract";
import { db } from "@/db";
import {
  folders,
  meetingFolders,
  meetings,
  templates,
  userSettings,
} from "@/db/schema";
import type { Viewer } from "./viewer";

/**
 * A template says how a meeting's notes are written: which sections, how
 * much detail, what to pull out. Its instructions go into the notes prompt.
 * The built-ins read like the notes they ask for, one heading per section with
 * what goes under it on the next line: people read them in Templates and copy
 * them to make their own.
 */
const builtIns: Omit<Template, "builtIn" | "visibility" | "mine">[] = [
  {
    id: "general",
    name: "General",
    instructions: `Use these sections, in this order:

## Summary
Two or three sentences.

## Key points
Bullets.

## Decisions
Bullets, or "None."

## Action items
Bullets as "- [ ] owner: task", or "None."`,
  },
  {
    id: "one-on-one",
    name: "1:1",
    instructions: `A one-on-one. Use these sections, in this order:

## Updates
What each person reported.

## Discussion
Each topic, with the gist of it.

## Feedback
Given either way, or "None."

## Action items
Bullets as "- [ ] owner: task", or "None."`,
  },
  {
    id: "customer-call",
    name: "Customer call",
    instructions: `A call with a customer or prospect. "Them" is the customer. Use these sections, in this order:

## About them
Company, role, setup, and what they use today.

## Needs and pain points

## Feedback and requests
About the product. Quote them briefly where it helps.

## Objections and concerns
Or "None."

## Next steps
Bullets as "- [ ] owner: task".`,
  },
  {
    id: "team-meeting",
    name: "Team meeting",
    instructions: `An internal team meeting. Use these sections, in this order:

## Summary
Two or three sentences.

## Updates
By person or project.

## Decisions
Bullets, or "None."

## Open questions
Or "None."

## Action items
Bullets as "- [ ] owner: task", or "None."`,
  },
  {
    id: "interview",
    name: "Interview",
    instructions: `A job interview. "Them" is the candidate unless the transcript says otherwise. Use these sections, in this order:

## Candidate
Their background in two or three sentences.

## Strengths
Bullets, with evidence from what they said.

## Concerns
Bullets, or "None."

## Notable answers
Each question and the gist of the answer.

## Next steps`,
  },
  {
    id: "follow-up-email",
    name: "Follow-up email",
    instructions: `Instead of notes, write a follow-up email the recorder can send to the others after the meeting:

- Start with "**Subject:** ..."
- A short greeting and a thank-you line.
- A recap of what was discussed and decided, as bullets.
- The next steps, with owners.
- A short sign-off, without a name.

Plain and warm, no filler.`,
  },
];

const DEFAULT_TEMPLATE_ID = "general";

const builtInIds = new Set(builtIns.map((template) => template.id));

function builtIn(id: string): Template | null {
  const found = builtIns.find((template) => template.id === id);
  return found
    ? { ...found, builtIn: true, visibility: "team", mine: false }
    : null;
}

const templateFields = {
  id: templates.id,
  name: templates.name,
  instructions: templates.instructions,
  visibility: templates.visibility,
  ownerUserId: templates.ownerUserId,
};

function toTemplate(
  viewer: Viewer,
  row: {
    id: string;
    name: string;
    instructions: string;
    visibility: "private" | "team";
    ownerUserId: string;
  },
): Template {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    visibility: row.visibility,
    builtIn: false,
    mine: row.ownerUserId === viewer.id,
  };
}

/** The templates a viewer may use: their own and the team's in the org. */
function templateVisibleTo(viewer: Viewer) {
  return and(
    eq(templates.orgId, viewer.orgId),
    or(eq(templates.ownerUserId, viewer.id), eq(templates.visibility, "team")),
  );
}

/** Built-ins first, then the viewer's and the team's, by name. */
export async function listTemplates(viewer: Viewer): Promise<Template[]> {
  const rows = await db
    .select(templateFields)
    .from(templates)
    .where(templateVisibleTo(viewer))
    .orderBy(asc(templates.name));
  return [
    ...builtIns.map((template) => builtIn(template.id)!),
    ...rows.map((row) => toTemplate(viewer, row)),
  ];
}

/** One template the viewer may use, or null. */
export async function getTemplate(
  viewer: Viewer,
  id: string,
): Promise<Template | null> {
  if (builtInIds.has(id)) return builtIn(id);
  const [row] = await db
    .select(templateFields)
    .from(templates)
    .where(and(eq(templates.id, id), templateVisibleTo(viewer)));
  return row ? toTemplate(viewer, row) : null;
}

export async function createTemplate(
  viewer: Viewer,
  input: z.infer<typeof saveTemplateInput>,
): Promise<Template> {
  const [row] = await db
    .insert(templates)
    .values({
      id: crypto.randomUUID(),
      orgId: viewer.orgId,
      ownerUserId: viewer.id,
      ...input,
    })
    .returning(templateFields);
  return toTemplate(viewer, row!);
}

function ownedTemplate(viewer: Viewer, id: string) {
  return and(
    eq(templates.id, id),
    eq(templates.orgId, viewer.orgId),
    eq(templates.ownerUserId, viewer.id),
  );
}

/** Only the owner edits a template; null when it isn't theirs. */
export async function updateTemplate(
  viewer: Viewer,
  id: string,
  input: z.infer<typeof saveTemplateInput>,
): Promise<Template | null> {
  const [row] = await db
    .update(templates)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(ownedTemplate(viewer, id))
    .returning(templateFields);
  return row ? toTemplate(viewer, row) : null;
}

/**
 * A partial edit of the owner's template; null when it isn't theirs. Only
 * the named fields are written, in one UPDATE that checks the owner, so a
 * concurrent edit of another field (say, making it private) is never undone
 * by a stale copy of it.
 */
export async function patchTemplate(
  viewer: Viewer,
  id: string,
  change: z.infer<typeof updateTemplateInput>,
): Promise<Template | null> {
  const set = Object.fromEntries(
    Object.entries(change).filter(([, value]) => value !== undefined),
  ) as Partial<z.infer<typeof saveTemplateInput>>;
  const [row] = await db
    .update(templates)
    .set({ ...set, updatedAt: new Date().toISOString() })
    .where(ownedTemplate(viewer, id))
    .returning(templateFields);
  return row ? toTemplate(viewer, row) : null;
}

/**
 * A private copy, "<name> (copy)", of any template the viewer may use
 * (a built-in, their own or the team's). Null when they may not use it.
 */
export async function duplicateTemplate(
  viewer: Viewer,
  id: string,
): Promise<Template | null> {
  const source = await getTemplate(viewer, id);
  if (!source) return null;
  return createTemplate(viewer, {
    name: `${source.name.slice(0, 73)} (copy)`,
    instructions: source.instructions,
    visibility: "private",
  });
}

/**
 * Delete one of the viewer's templates. Folders and meetings that named it
 * fall back to the next choice in resolveTemplate.
 */
export async function deleteTemplate(
  viewer: Viewer,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(templates)
    .where(ownedTemplate(viewer, id))
    .returning({ id: templates.id });
  return deleted.length > 0;
}

/** The viewer's default template id (a template they may still use). */
export async function getDefaultTemplateId(viewer: Viewer): Promise<string> {
  const [row] = await db
    .select({ id: userSettings.defaultTemplateId })
    .from(userSettings)
    .where(
      and(
        eq(userSettings.orgId, viewer.orgId),
        eq(userSettings.userId, viewer.id),
      ),
    );
  if (row?.id && (await getTemplate(viewer, row.id))) return row.id;
  return DEFAULT_TEMPLATE_ID;
}

/** False when the viewer may not use that template. */
export async function setDefaultTemplateId(
  viewer: Viewer,
  templateId: string,
): Promise<boolean> {
  if (!(await getTemplate(viewer, templateId))) return false;
  const updatedAt = new Date().toISOString();
  await db
    .insert(userSettings)
    .values({
      orgId: viewer.orgId,
      userId: viewer.id,
      defaultTemplateId: templateId,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [userSettings.orgId, userSettings.userId],
      set: { defaultTemplateId: templateId, updatedAt },
    });
  return true;
}

/**
 * The template a meeting's notes are written with, the first that applies:
 * `wanted` (a template being tried, see rewriteWithTemplate); the one
 * chosen on the meeting; the default of a folder it is in (the
 * earliest it was added to, counting team folders and the owner's own);
 * the owner's default; General. A choice the owner may no longer use (a
 * deleted template, or another person's that went private) is skipped.
 */
export async function resolveTemplate(
  meetingId: string,
  wanted?: string,
): Promise<Template> {
  const [meeting] = await db
    .select({
      orgId: meetings.orgId,
      ownerUserId: meetings.ownerUserId,
      templateId: meetings.templateId,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  if (!meeting) return builtIn(DEFAULT_TEMPLATE_ID)!;
  const owner: Viewer = { id: meeting.ownerUserId, orgId: meeting.orgId };

  const folderDefaults = await db
    .select({ templateId: folders.defaultTemplateId })
    .from(meetingFolders)
    .innerJoin(folders, eq(folders.id, meetingFolders.folderId))
    .where(
      and(
        eq(meetingFolders.meetingId, meetingId),
        eq(folders.orgId, meeting.orgId),
        or(
          eq(folders.space, "team"),
          eq(folders.ownerUserId, meeting.ownerUserId),
        ),
      ),
    )
    .orderBy(asc(meetingFolders.addedAt));

  const candidates = [
    wanted,
    meeting.templateId,
    ...folderDefaults.map((row) => row.templateId),
    await getDefaultTemplateId(owner),
  ];
  for (const id of candidates) {
    if (!id) continue;
    const template = await getTemplate(owner, id);
    if (template) return template;
  }
  return builtIn(DEFAULT_TEMPLATE_ID)!;
}
