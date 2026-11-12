import { beforeEach, describe, expect, it, vi } from "vitest";

// The Gateway's OpenAI fetch, faked: records the request, answers what the
// test sets. The Worker env is empty; nothing reads it past createGatewayFetch.
const fake = vi.hoisted(() => ({
  requests: [] as { url: string; init: RequestInit }[],
  answer: () => Response.json({ text: " Hello there " }),
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@every-app/sdk/server", async (original) => ({
  ...(await original<typeof import("@every-app/sdk/server")>()),
  createGatewayFetch: () => async (url: string, init: RequestInit) => {
    fake.requests.push({ url, init });
    return fake.answer();
  },
}));

const { transcribeChunk, TranscriptionRefused } = await import(
  "./transcription"
);

const request = new Request("https://scribe.test/api/v1/x");
const wav = new File([new Uint8Array(44)], "chunk.wav", { type: "audio/wav" });

beforeEach(() => {
  fake.requests = [];
  fake.answer = () => Response.json({ text: " Hello there " });
});

describe("transcribeChunk", () => {
  it("posts the chunk to OpenAI's transcription route through the Gateway", async () => {
    expect(await transcribeChunk(request, wav, "en")).toBe("Hello there");
    const [sent] = fake.requests;
    expect(sent?.url).toBe(
      "http://every-app-gateway.internal/api/ai/openai/v1/audio/transcriptions",
    );
    const form = sent?.init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("en");
    expect((form.get("file") as File).name).toBe("chunk.wav");
  });

  it("turns a Gateway refusal into the code and sentence the API shows", async () => {
    fake.answer = () =>
      Response.json(
        {
          error: "forbidden",
          code: "ai_route_not_allowed",
          message: "Not allowed",
        },
        {
          status: 403,
          headers: { "x-everyapp-error": "ai_route_not_allowed" },
        },
      );
    await expect(transcribeChunk(request, wav)).rejects.toMatchObject({
      name: "Error",
      code: "ai_route_not_allowed",
      status: 403,
    });
    await expect(transcribeChunk(request, wav)).rejects.toBeInstanceOf(
      TranscriptionRefused,
    );
  });
});
