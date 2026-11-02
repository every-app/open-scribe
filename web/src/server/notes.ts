import {
  aiBaseUrl,
  createGatewayFetch,
  gatewayRefusal,
} from "@every-app/sdk/server";
import { env, waitUntil } from "cloudflare:workers";
import {
  attendeesOf,
  chooseTemplate,
  jottingsText,
  markFailed,
  rewriteWithTemplate,
  saveNotes,
  transcriptText,
} from "./meetings";
import { buildNotesMessages, nothingToSummarize } from "./notesPrompt";
import { resolveTemplate } from "./templates";
import type { Viewer } from "./viewer";

/** The notes model: the one entry of the manifest's `ai.models`. */
function notesModel(): string {
  const model = env.EVERYAPP_MANIFEST.ai?.models?.[0];
  if (!model) throw new Error("everyapp.config.ts lists no ai.models");
  return model;
}

/**
 * Write the notes from the person's jottings (the outline) and the
 * transcript (the detail) with the meeting's template, and save them.
 * Runs in the background (`waitUntil`) after the Mac app finishes a meeting,
 * or after the owner picks another template (`templateId`, pinned on the
 * meeting only once the notes are saved). `for` is that request, so the
 * Gateway attributes the call to that person.
 */
export async function generateNotes(
  request: Request,
  meetingId: string,
  title: string,
  templateId?: string,
): Promise<void> {
  try {
    const template = await resolveTemplate(meetingId, templateId);
    const [transcript, jottings, attendees] = await Promise.all([
      transcriptText(meetingId),
      jottingsText(meetingId),
      attendeesOf(meetingId),
    ]);
    if (nothingToSummarize({ transcript, jottings })) {
      await saveNotes(
        meetingId,
        "_No speech was transcribed._",
        notesModel(),
        template.id,
      );
      return;
    }
    const ai = createGatewayFetch({ env, for: request });
    const response = await ai(`${aiBaseUrl("openai")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: notesModel(),
        messages: buildNotesMessages({
          title,
          instructions: template.instructions,
          transcript,
          jottings,
          attendees,
        }),
      }),
    });
    const refused = await gatewayRefusal(response);
    if (refused) throw new Error(`${refused.code}: ${refused.message}`);
    if (!response.ok) throw new Error(`OpenAI answered ${response.status}`);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const markdown = body.choices?.[0]?.message?.content?.trim();
    if (!markdown) throw new Error("OpenAI answered no content");
    await saveNotes(meetingId, markdown, notesModel(), template.id);
  } catch (error) {
    console.error("[notes] failed", meetingId, error);
    await markFailed(meetingId);
  }
}

/**
 * Pick the meeting's template (the owner's). A finished meeting's notes are
 * rewritten with it in the background, and the template is pinned only once
 * they are saved, so a failed rewrite keeps the earlier notes and template.
 * A recording one uses it when it ends. Null when not allowed (not the
 * owner's meeting, a template they may not use, or notes being written).
 */
export async function applyTemplate(
  request: Request,
  viewer: Viewer,
  meetingId: string,
  templateId: string | null,
): Promise<{ rewriting: boolean } | null> {
  if (templateId) {
    const meeting = await rewriteWithTemplate(viewer, meetingId, templateId);
    if (meeting) {
      waitUntil(generateNotes(request, meeting.id, meeting.title, templateId));
      return { rewriting: true };
    }
  }
  if (await chooseTemplate(viewer, meetingId, templateId)) {
    return { rewriting: false };
  }
  return null;
}
