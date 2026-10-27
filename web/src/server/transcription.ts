import {
  createGatewayFetch,
  gatewayRefusal,
  providerBaseUrl,
  refusalFromError,
} from "@every-app/sdk/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

/** The streaming transcription model (OpenAI's Realtime transcription session). */
const TRANSCRIPTION_MODEL = "gpt-live-transcribe";
/** Realtime client secrets live at most two hours; the Mac app re-mints past that. */
const SECRET_SECONDS = 7200;

export const transcriptionTokenInput = z
  .object({
    // The microphone wants near-field noise reduction; system audio none.
    source: z.enum(["mic", "system", "mixed"]).default("mixed"),
    language: z.string().min(2).max(10).optional(),
  })
  .strict();

interface TranscriptionToken {
  value: string;
  expiresAt: number;
  model: string;
  sampleRate: 24000;
}

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
  let ai: ReturnType<typeof createGatewayFetch>;
  try {
    ai = createGatewayFetch({ env, for: request });
  } catch (error) {
    // Local dev without OPENAI_API_KEY in .dev.vars: the same refusal the Gateway sends.
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
                ...(input.language ? { language: input.language } : {}),
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

export class TranscriptionRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
