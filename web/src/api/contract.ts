/**
 * The /api/v1 contract: every request body and query as a zod schema, and
 * every response as a TypeScript type. The Worker validates with these
 * schemas and its queries return these types, so this file is the one
 * source of truth.
 *
 * It imports nothing but zod (no Worker modules, no `@/` paths), so the
 * desktop app can import or copy it as is.
 *
 * Every route answers JSON with `cache-control: no-store`. Errors are
 * `ApiError` with 400, 401, 403, 404, 409, 502, 503 or 500. A row the caller
 * may not see is a 404, never a 403.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared

/** A built-in template's id ("general", …) or a custom one's uuid. */
export const templateIdInput = z.string().min(1).max(64);

export interface ApiError {
  /**
   * A stable code: unauthenticated, not_found, forbidden, invalid_json,
   * invalid_body, invalid_query, invalid_cursor, busy, unknown_template,
   * template_unavailable, internal_error, …
   */
  error: string;
  message?: string;
  /** zod's issues, on invalid_body and invalid_query. */
  issues?: unknown[];
}

/** DELETE routes and the like. */
export interface OkResponse {
  ok: true;
}

// ---------------------------------------------------------------------------
// Meetings

export type MeetingStatus = "recording" | "processing" | "done" | "failed";
export type Visibility = "private" | "team";
export type Speaker = "me" | "them";

export interface Attendee {
  email: string | null;
  name: string | null;
  self: boolean;
}

/** One meeting in a list. */
export interface MeetingRow {
  id: string;
  title: string;
  /** ISO 8601. */
  startsAt: string;
  endsAt: string | null;
  status: MeetingStatus;
  visibility: Visibility;
  ownerUserId: string;
  ownerEmail: string | null;
  attendeeCount: number;
  /** The caller owns it. */
  mine: boolean;
}

/** One committed transcript turn. */
export interface Segment {
  seq: number;
  startedMs: number;
  endedMs: number;
  /** "me" (microphone), "them" (system audio), null for a mixed stream. */
  speaker: Speaker | null;
  text: string;
}

export interface Notes {
  markdown: string;
  /** The model that wrote them ("manual" if the owner wrote them first). */
  model: string;
  generatedAt: string;
  /** When the owner last edited them; null for notes as written. */
  editedAt: string | null;
}

/** The owner's notepad. */
export interface Jottings {
  markdown: string;
  /** ISO 8601: when the person typed it. */
  updatedAt: string;
}

export interface MeetingDetail extends MeetingRow {
  attendees: Attendee[];
  /** The folders it is in that the caller can see. */
  folders: { id: string; name: string; space: Visibility }[];
  /**
   * The template the notes use, and whether it was chosen on the meeting.
   * Someone else's private template shows as `{ id: "", name: "Private
   * template", chosen: false }`.
   */
  template: { id: string; name: string; chosen: boolean };
  segments: Segment[];
  notes: Notes | null;
  /** The owner's alone: null for anyone else, or before they type. */
  jottings: Jottings | null;
  /** The owner's alone: empty for anyone else. */
  shareLinks: { id: string; createdAt: string }[];
}

const attendeeInput = z
  .object({
    email: z.string().max(320).nullable().optional(),
    name: z.string().max(255).nullable().optional(),
    self: z.boolean().optional(),
  })
  .strict();

/** POST /meetings → 201 `CreateMeetingResponse` */
export const createMeetingInput = z
  .object({
    title: z.string().trim().min(1).max(255),
    startsAt: z.string().datetime({ offset: true }).optional(),
    calendarEventId: z.string().max(255).optional(),
    attendees: z.array(attendeeInput).max(200).optional(),
  })
  .strict();
export interface CreateMeetingResponse {
  id: string;
  meeting: MeetingRow;
}

/** Title and visibility (the web's server function). */
export const updateMeetingInput = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    visibility: z.enum(["private", "team"]).optional(),
  })
  .strict();

/**
 * PATCH /meetings/:id (owner only) → `PatchMeetingResponse`.
 * `templateId` on a recording meeting picks the template for when it ends
 * (null clears the choice); on a finished one it rewrites the notes in the
 * background (`rewriting: true`), and the template is pinned only once they
 * are saved. Making a meeting private unfiles it from team folders.
 */
export const patchMeetingInput = updateMeetingInput.extend({
  templateId: templateIdInput.nullable().optional(),
});
export interface PatchMeetingResponse {
  meeting: MeetingDetail;
  rewriting: boolean;
}

/** The list filter, typed (the web's server function). */
export const listMeetingsInput = z
  .object({
    /** Only the meetings in this folder (one the caller can see). */
    folderId: z.string().uuid().optional(),
    /** Only team meetings other people own. */
    shared: z.boolean().optional(),
    /** Only the caller's own meetings. */
    mine: z.boolean().optional(),
    /** Only meetings whose title contains this (case-insensitive). */
    q: z.string().trim().min(1).max(200).optional(),
    /** Where the previous page ended (its `nextCursor`). */
    cursor: z.string().max(400).optional(),
    /** How many at most; all of them when absent. */
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

const flag = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1")
  .optional();

/**
 * GET /meetings?folderId&shared&mine&q&cursor&limit → `ListMeetingsResponse`,
 * newest first. `limit` defaults to 50; `nextCursor` is null on the last page.
 */
export const listMeetingsQuery = z
  .object({
    folderId: z.string().uuid().optional(),
    shared: flag,
    mine: flag,
    q: z.string().trim().min(1).max(200).optional(),
    cursor: z.string().max(400).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export interface ListMeetingsResponse {
  meetings: MeetingRow[];
  nextCursor: string | null;
}

/**
 * GET /search?q=&limit=&cursor= → `SearchResponse`: full-text search over
 * the meetings the caller can read (the same rules as GET /meetings), in
 * their titles, notes, transcripts, and the caller's own jottings (never a
 * teammate's). Words match by prefix, accents ignored; all words must match
 * within one field. Best match first. `limit` defaults to 20.
 */
export const searchQuery = z
  .object({
    q: z.string().trim().min(1).max(200),
    cursor: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type SearchField = "title" | "notes" | "jottings" | "transcript";

/**
 * A short excerpt as plain text (never markup: render it as text), with the
 * matched words as [start, end) offsets into `text`, in UTF-16 code units
 * (JavaScript string indices). "…" marks where the excerpt was cut.
 */
export interface SearchSnippet {
  text: string;
  ranges: { start: number; end: number }[];
}

export interface SearchResult {
  meeting: MeetingRow;
  /** Where the best match is. */
  field: SearchField;
  snippet: SearchSnippet;
}

export interface SearchResponse {
  results: SearchResult[];
  nextCursor: string | null;
}

/** GET /meetings/:id */
export interface GetMeetingResponse {
  meeting: MeetingDetail;
}

/**
 * PUT /meetings/:id/jottings (owner only, any status) → `SaveJottingsResponse`.
 * Send the whole text with when it was typed; a save older than the stored
 * one is ignored (`applied: false`) and the answer carries what is stored.
 * `updatedAt` defaults to now; a time in the future counts as now.
 */
export const saveJottingsInput = z
  .object({
    markdown: z.string().max(100_000),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export interface SaveJottingsResponse {
  jottings: Jottings;
  applied: boolean;
}

/**
 * PUT /meetings/:id/notes (owner only) → `EditNotesResponse`; sets
 * `editedAt`. 409 `busy` while recording or while the notes are written.
 */
export const editNotesInput = z
  .object({ markdown: z.string().max(200_000) })
  .strict();
export interface EditNotesResponse {
  notes: Notes;
}

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
/** POST /meetings/:id/segments: a bare array, or `{ segments: [...] }`. */
export const appendSegmentsInput = z
  .union([segmentList, z.object({ segments: segmentList }).strict()])
  .transform((input) => (Array.isArray(input) ? { segments: input } : input));

/** POST /meetings/:id/finish → `{ meeting: MeetingRow }`; notes follow. */
export interface FinishMeetingResponse {
  meeting: MeetingRow;
}

/** POST /meetings/:id/transcription-token → `TranscriptionToken` */
export const transcriptionTokenInput = z
  .object({
    // The microphone wants near-field noise reduction; system audio none.
    source: z.enum(["mic", "system", "mixed"]).default("mixed"),
    language: z.string().min(2).max(10).optional(),
  })
  .strict();
export interface TranscriptionToken {
  value: string;
  expiresAt: number;
  model: string;
  sampleRate: 24000;
}

/** POST /meetings/:id/share → 201 */
export interface ShareLinkResponse {
  link: { id: string; url: string };
}

// ---------------------------------------------------------------------------
// Folders

export interface Folder {
  id: string;
  name: string;
  space: Visibility;
  defaultTemplateId: string | null;
}
export type FolderWithCount = Folder & {
  /** The folder's meetings the caller can read. */
  meetingCount: number;
};

/** GET /folders: the caller's private folders and the team's, by name. */
export interface ListFoldersResponse {
  folders: FolderWithCount[];
}

/** POST /folders → 201 `FolderResponse` */
export const createFolderInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    space: z.enum(["private", "team"]),
  })
  .strict();

/**
 * PATCH /folders/:id → `FolderResponse`. Anyone on the team changes a team
 * folder; a private one is its owner's. A team folder's template must be a
 * team or built-in one (400 template_unavailable).
 */
export const updateFolderInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    defaultTemplateId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();
export interface FolderResponse {
  folder: Folder | FolderWithCount;
}

/**
 * PUT /folders/:id/meetings/:meetingId → `FileMeetingResponse`. Filing the
 * caller's private meeting in a team folder shares it (`shared: true`).
 */
export interface FileMeetingResponse {
  shared: boolean;
}

// ---------------------------------------------------------------------------
// Templates

export interface Template {
  id: string;
  name: string;
  instructions: string;
  builtIn: boolean;
  visibility: Visibility;
  /** The caller owns it (false for built-ins). */
  mine: boolean;
}

/** GET /templates: built-ins first, then the caller's and the team's. */
export interface ListTemplatesResponse {
  templates: Template[];
  defaultTemplateId: string;
}

/** POST /templates → 201 `TemplateResponse` */
export const saveTemplateInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    instructions: z.string().trim().min(1).max(4000),
    visibility: z.enum(["private", "team"]),
  })
  .strict();

/** PATCH /templates/:id (owner only) → `TemplateResponse` */
export const updateTemplateInput = saveTemplateInput.partial();

/** GET /templates/:id, POST /templates/:id/duplicate (201) */
export interface TemplateResponse {
  template: Template;
}

// ---------------------------------------------------------------------------
// Settings

/** The person's settings on the server; light/dark is per device. */
export interface Settings {
  defaultTemplateId: string;
}

/** PATCH /settings → `SettingsResponse`; GET answers the same. */
export const updateSettingsInput = z
  .object({ defaultTemplateId: templateIdInput.optional() })
  .strict();
export interface SettingsResponse {
  settings: Settings;
}

// ---------------------------------------------------------------------------
// Account and calendar

export type CalendarStatus =
  | { available: false }
  | {
      available: true;
      connected: false;
      reconnect: boolean;
      connectUrl: string;
    }
  | { available: true; connected: true };

/** GET /me */
export interface MeResponse {
  user: { id: string; email: string; orgName: string | null };
  calendar: CalendarStatus;
  google: { connected: boolean; connectUrl: string | null };
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: { email: string | null; name: string | null; self: boolean }[];
  conferenceUrl: string | null;
  location: string | null;
}

/**
 * GET /calendar/upcoming?hours=24 (1–168). 409 with `connected: false` and
 * `connectUrl` when Google isn't connected; 502 with `error` when Google
 * fails.
 */
export interface UpcomingResponse {
  events: CalendarEvent[];
  connected: boolean;
  connectUrl?: string | null;
  calendar: CalendarStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Input types

export type CreateMeetingInput = z.input<typeof createMeetingInput>;
export type PatchMeetingInput = z.input<typeof patchMeetingInput>;
export type ListMeetingsQuery = z.input<typeof listMeetingsQuery>;
export type SearchQuery = z.input<typeof searchQuery>;
export type SaveJottingsInput = z.input<typeof saveJottingsInput>;
export type EditNotesInput = z.input<typeof editNotesInput>;
export type AppendSegmentsInput = z.input<typeof appendSegmentsInput>;
export type TranscriptionTokenInput = z.input<typeof transcriptionTokenInput>;
export type CreateFolderInput = z.input<typeof createFolderInput>;
export type UpdateFolderInput = z.input<typeof updateFolderInput>;
export type SaveTemplateInput = z.input<typeof saveTemplateInput>;
export type UpdateTemplateInput = z.input<typeof updateTemplateInput>;
export type UpdateSettingsInput = z.input<typeof updateSettingsInput>;
