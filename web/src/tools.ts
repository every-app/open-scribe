// The app's tools for AI clients (Claude, Cursor, ...). The Gateway serves
// them at /mcp and calls each with the signed-in user; the app never speaks
// MCP itself.
import { ToolError, defineTools } from "@every-app/sdk/server";
import { z } from "zod";
import * as folders from "@/server/folders";
import * as meetings from "@/server/meetings";

export const tools = defineTools(
  {
    list_meetings: {
      description:
        "List the meetings the user can read: their own and the team's, newest first. Pass folderId (from list_folders) for one folder's meetings.",
      risk: "read",
      input: z.object({ folderId: z.string().uuid().optional() }).strict(),
      handler: (input, { user }) => meetings.listMeetings(user, input),
    },
    list_folders: {
      description:
        "List the user's folders: their private ones and the team's (space: private or team).",
      risk: "read",
      input: z.object({}).strict(),
      handler: (_input, { user }) => folders.listFolders(user),
    },
    get_meeting: {
      description: "One meeting with its notes and transcript.",
      risk: "read",
      input: z.object({ id: z.string().uuid() }).strict(),
      handler: async (input, { user }) =>
        (await meetings.getMeeting(user, input.id)) ??
        raise("No meeting with that id"),
    },
    set_meeting_visibility: {
      description:
        "Make one of the user's own meetings private, or visible to the whole team.",
      risk: "write",
      idempotent: true,
      input: z
        .object({
          id: z.string().uuid(),
          visibility: z.enum(["private", "team"]),
        })
        .strict(),
      handler: async (input, { user }) =>
        (await meetings.updateMeeting(user, input.id, {
          visibility: input.visibility,
        })) ?? raise("No meeting of yours with that id"),
    },
  },
  {
    instructions:
      "Never guess ids: call list_meetings or list_folders first when an id isn't already known.",
  },
);

/** A message the model may read; any other error reaches it as "Internal error". */
function raise(message: string): never {
  throw new ToolError(message);
}
