// The app's tools for AI clients (Claude, Cursor, ...). The Gateway serves
// them at /mcp and calls each with the signed-in user; the app never speaks
// MCP itself.
import { ToolError, defineTools } from "@every-app/sdk/server";
import { z } from "zod";
import * as meetings from "@/server/meetings";

export const tools = defineTools(
  {
    list_meetings: {
      description:
        "List the meetings the user can read: their own and the team's, newest first.",
      risk: "read",
      input: z.object({}).strict(),
      handler: (_input, { user }) => meetings.listMeetings(user),
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
      "Never guess meeting ids: call list_meetings first when an id isn't already known.",
  },
);

/** A message the model may read; any other error reaches it as "Internal error". */
function raise(message: string): never {
  throw new ToolError(message);
}
