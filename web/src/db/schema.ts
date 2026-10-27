import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = () => sql`(current_timestamp)`;

/** One recorded meeting. Private to its owner unless `visibility` is `team`. */
export const meetings = sqliteTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    title: text("title").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at"),
    calendarEventId: text("calendar_event_id"),
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
  (table) => [index("segments_meeting_seq").on(table.meetingId, table.seq)],
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
