/**
 * The shapes `/api/v1` answers with, for clients (the desktop app) to
 * mirror. Type-only: every type here comes from the server module that
 * builds it, so this file can't drift from what the routes send.
 *
 * Every route answers JSON with `cache-control: no-store`. Errors are
 * `ApiError` with 400, 401, 403, 404, 409, 502, 503 or 500.
 */
import type { CalendarEvent } from "./calendar";
import type { Folder } from "./folders";
import type { Jottings, MeetingDetail, MeetingRow, Segment } from "./meetings";
import type { Settings } from "./settings";
import type { Template } from "./templates";

export type {
  CalendarEvent,
  Folder,
  Jottings,
  MeetingDetail,
  MeetingRow,
  Segment,
  Settings,
  Template,
};

export interface ApiError {
  /** A stable code: not_found, invalid_body, invalid_query, busy, … */
  error: string;
  message?: string;
}

export type Notes = NonNullable<MeetingDetail["notes"]>;
export type FolderWithCount = Folder & { meetingCount: number };

// Meetings
/** GET /meetings?folderId&shared&mine&q&cursor&limit */
export interface ListMeetingsResponse {
  meetings: MeetingRow[];
  nextCursor: string | null;
}
/** GET /meetings/:id */
export interface GetMeetingResponse {
  meeting: MeetingDetail;
}
/** PATCH /meetings/:id { title?, visibility?, templateId? } */
export interface PatchMeetingResponse {
  meeting: MeetingDetail;
  rewriting: boolean;
}
/** PUT /meetings/:id/jottings { markdown, updatedAt? } */
export interface SaveJottingsResponse {
  jottings: Jottings;
  applied: boolean;
}
/** PUT /meetings/:id/notes { markdown } */
export interface EditNotesResponse {
  notes: Notes;
}

// Folders
/** GET /folders */
export interface ListFoldersResponse {
  folders: FolderWithCount[];
}
/** POST /folders, PATCH /folders/:id */
export interface FolderResponse {
  folder: Folder | FolderWithCount;
}
/** PUT /folders/:id/meetings/:meetingId */
export interface FileMeetingResponse {
  shared: boolean;
}

// Templates
/** GET /templates */
export interface ListTemplatesResponse {
  templates: Template[];
  defaultTemplateId: string;
}
/** GET, PATCH /templates/:id; POST /templates, /templates/:id/duplicate */
export interface TemplateResponse {
  template: Template;
}

// Settings
/** GET, PATCH /settings */
export interface SettingsResponse {
  settings: Settings;
}

/** DELETE routes and the like. */
export interface OkResponse {
  ok: true;
}
