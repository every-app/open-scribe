import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = () => sql`(current_timestamp)`;

export interface Attendee {
  email: string | null;
  name: string | null;
  self: boolean;
}

/** One recorded meeting. Private to its owner unless `visibility` is `team`. */
export const meetings = sqliteTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    // For showing whose meeting it is; null on meetings from before it was kept.
    ownerEmail: text("owner_email"),
    title: text("title").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at"),
    calendarEventId: text("calendar_event_id"),
    // The calendar event's guests, as the Mac app sent them.
    attendees: text("attendees", { mode: "json" }).$type<Attendee[]>(),
    // The template the notes were (or will be) written with; null picks one
    // when they are written (see resolveTemplate in src/server/templates.ts).
    templateId: text("template_id"),
    status: text("status", {
      enum: ["recording", "processing", "done", "failed"],
    })
      .notNull()
      .default("recording"),
    visibility: text("visibility", { enum: ["private", "team"] })
      .notNull()
      .default("private"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (table) => [index("meetings_org_owner").on(table.orgId, table.ownerUserId)],
);

/** The transcript, as the Mac app posted it: one row per committed turn. */
export const transcriptSegments = sqliteTable(
  "transcript_segments",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    startedMs: integer("started_ms").notNull(),
    endedMs: integer("ended_ms").notNull(),
    // "me" (the microphone), "them" (system audio), or null for a mixed stream.
    speaker: text("speaker", { enum: ["me", "them"] }),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull().default(now()),
  },
  // One row per (meeting, seq): a retried post is ignored, never doubled.
  (table) => [
    uniqueIndex("segments_meeting_seq").on(table.meetingId, table.seq),
  ],
);

/** The polished notes, one per meeting. */
export const notes = sqliteTable("notes", {
  meetingId: text("meeting_id")
    .primaryKey()
    .references(() => meetings.id, { onDelete: "cascade" }),
  markdown: text("markdown").notNull(),
  model: text("model").notNull(),
  generatedAt: text("generated_at").notNull().default(now()),
  editedAt: text("edited_at"),
});

/** A public link: `id` is the unguessable token in the URL. */
export const shareLinks = sqliteTable("share_links", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  revokedAt: text("revoked_at"),
});

/**
 * A folder in a space: `private` folders are their creator's alone; `team`
 * folders belong to the whole organization, and a meeting in one is visible
 * to every member.
 */
export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    space: text("space", { enum: ["private", "team"] }).notNull(),
    name: text("name").notNull(),
    // Notes of meetings in this folder are written with it, unless the
    // meeting has its own.
    defaultTemplateId: text("default_template_id"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (table) => [index("folders_org").on(table.orgId, table.space)],
);

/** Which folders a meeting is in; a meeting can be in several. */
export const meetingFolders = sqliteTable(
  "meeting_folders",
  {
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    folderId: text("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    addedBy: text("added_by").notNull(),
    addedAt: text("added_at").notNull().default(now()),
  },
  (table) => [
    primaryKey({ columns: [table.meetingId, table.folderId] }),
    index("meeting_folders_folder").on(table.folderId),
  ],
);

/**
 * A notes template someone wrote. The built-in ones live in code
 * (src/server/templates.ts). `team` templates are offered to everyone in
 * the organization; only the owner edits one.
 */
export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    instructions: text("instructions").notNull(),
    visibility: text("visibility", { enum: ["private", "team"] })
      .notNull()
      .default("private"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (table) => [index("templates_org").on(table.orgId)],
);

/** Per-person settings. */
export const userSettings = sqliteTable(
  "user_settings",
  {
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    defaultTemplateId: text("default_template_id"),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] })],
);
