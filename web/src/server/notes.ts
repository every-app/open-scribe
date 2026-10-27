import {
  aiBaseUrl,
  createGatewayFetch,
  gatewayRefusal,
} from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import { markFailed, saveNotes, transcriptText } from "./meetings";

/** The notes model: the one entry of the manifest's `ai.models`. */
function notesModel(): string {
  const model = env.EVERYAPP_MANIFEST.ai?.models?.[0];
  if (!model) throw new Error("everyapp.config.ts lists no ai.models");
  return model;
}

const SYSTEM_PROMPT = `You write meeting notes from a raw transcript. Lines may be prefixed "me:" (the person who recorded) or "them:" (everyone else).
Answer in Markdown with exactly these sections: "## Summary" (two or three sentences), "## Key points" (bullets), "## Decisions" (bullets, or "None."), "## Action items" (bullets as "- [ ] owner: task", or "None.").
Be concrete and short. Never invent what the transcript doesn't say.`;

/**
 * Turn the transcript into notes and save them. Runs after the Mac app
 * finishes a meeting, in the background (`waitUntil`). `for` is the
 * finishing request, so the Gateway attributes the call to that person.
 */
export async function generateNotes(
  request: Request,
  meetingId: string,
  title: string,
): Promise<void> {
  try {
    const transcript = await transcriptText(meetingId);
    if (!transcript.trim()) {
      await saveNotes(meetingId, "_No speech was transcribed._", notesModel());
      return;
    }
    const ai = createGatewayFetch({ env, for: request });
    const response = await ai(`${aiBaseUrl("openai")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: notesModel(),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Meeting: ${title}\n\nTranscript:\n${transcript.slice(0, 400_000)}`,
          },
        ],
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
    await saveNotes(meetingId, markdown, notesModel());
  } catch (error) {
    console.error("[notes] failed", meetingId, error);
    await markFailed(meetingId);
  }
}
