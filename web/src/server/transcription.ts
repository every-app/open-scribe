import {
  aiBaseUrl,
  createGatewayFetch,
  gatewayRefusal,
  providerBaseUrl,
  refusalFromError,
} from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import type { z } from "zod";
import type {
  TranscriptionToken,
  transcriptionTokenInput,
} from "@/api/contract";

/** The streaming transcription model (OpenAI's Realtime transcription session). */
const TRANSCRIPTION_MODEL = "gpt-live-transcribe";
/** The fallback's model, for chunks posted to the Worker (the manifest's `ai.models`). */
const CHUNK_MODEL = "gpt-4o-mini-transcribe";
/** A 30 s chunk of 24 kHz PCM16 is 1.4 MB; OpenAI takes 25 MB. */
export const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
/** Realtime client secrets live at most two hours; the Mac app re-mints past that. */
const SECRET_SECONDS = 7200;

/**
 * A short-lived OpenAI Realtime client secret the Mac app streams audio
 * with. Minted through the Gateway (its key, never the app's), on a path
 * both the manifest's `ai.routes` and the operator's `AI_PROXY_EXTRA_ROUTES`
 * must allow. A refusal throws `TranscriptionRefused` with the Gateway's
 * code and sentence.
 */
export async function mintTranscriptionToken(
  request: Request,
  input: z.infer<typeof transcriptionTokenInput>,
): Promise<TranscriptionToken> {
  const ai = openai(request);
  const response = await ai(
    `${providerBaseUrl("openai")}/v1/realtime/client_secrets`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: SECRET_SECONDS },
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: {
                model: TRANSCRIPTION_MODEL,
                // `languages` is what the reference documents and what
                // Scrawl's working gpt-live-transcribe session sends.
                ...(input.language ? { languages: [input.language] } : {}),
              },
              noise_reduction:
                input.source === "mic" ? { type: "near_field" } : null,
              // The Mac app decides turns itself (gpt-live-transcribe takes no VAD).
              turn_detection: null,
            },
          },
        },
      }),
    },
  );
  const refused = await gatewayRefusal(response);
  if (refused) {
    throw new TranscriptionRefused(
      refused.code,
      refused.setup ?? refused.message,
      refused.status,
    );
  }
  if (!response.ok) {
    throw new TranscriptionRefused(
      "openai_error",
      `OpenAI answered ${response.status}`,
      502,
    );
  }
  const body = (await response.json()) as { value: string; expires_at: number };
  return {
    value: body.value,
    expiresAt: body.expires_at,
    model: TRANSCRIPTION_MODEL,
    sampleRate: 24000,
  };
}

/** The Gateway's OpenAI fetch; local dev without a key throws the same refusal. */
function openai(request: Request): ReturnType<typeof createGatewayFetch> {
  try {
    return createGatewayFetch({ env, for: request });
  } catch (error) {
    const refusal = refusalFromError(error);
    if (refusal) {
      throw new TranscriptionRefused(
        refusal.code,
        refusal.setup ?? refusal.message,
        refusal.status,
      );
    }
    throw error;
  }
}

/**
 * The fallback when the Gateway's operator hasn't allowed the Realtime
 * route: the Mac app posts a short WAV chunk, the Worker forwards it to
 * OpenAI's transcription endpoint (an inference route, always allowed) and
 * keeps the text only. The audio is read once and dropped.
 */
export async function transcribeChunk(
  request: Request,
  file: File,
  language?: string,
): Promise<string> {
  const ai = openai(request);
  const form = new FormData();
  form.set("model", CHUNK_MODEL);
  form.set("file", file, file.name || "chunk.wav");
  form.set("response_format", "json");
  if (language) form.set("language", language);
  const response = await ai(`${aiBaseUrl("openai")}/audio/transcriptions`, {
    method: "POST",
    body: form,
  });
  const refused = await gatewayRefusal(response);
  if (refused) {
    throw new TranscriptionRefused(
      refused.code,
      refused.setup ?? refused.message,
      refused.status,
    );
  }
  if (!response.ok) {
    throw new TranscriptionRefused(
      "openai_error",
      `OpenAI answered ${response.status}`,
      502,
    );
  }
  const body = (await response.json()) as { text?: string };
  return (body.text ?? "").trim();
}

export class TranscriptionRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
