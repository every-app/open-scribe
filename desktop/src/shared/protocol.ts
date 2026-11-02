// Helper protocol v1 (docs/desktop-plan.md, "Helper protocol (v1)"). Newline-delimited JSON on
// the helper's stdin/stdout; logs on stderr. Change this only together with Lane H and the plan.

export const HELPER_PROTOCOL = 1;

export type PermissionStatus = "granted" | "denied" | "undetermined" | "unknown";
export type Speaker = "me" | "them";
export type ChannelHealth = "ok" | "silent" | "error";

/** Each request `cmd`, its params and its result. */
export interface HelperCommands {
  hello: { params: { protocol: number }; result: { protocol: number; version: string; macos: string } };
  "permissions.status": {
    params: undefined;
    result: { mic: PermissionStatus; systemAudio: PermissionStatus };
  };
  "permissions.request": {
    params: { kind: "mic" | "systemAudio" };
    result: { mic: PermissionStatus; systemAudio: PermissionStatus };
  };
  "record.start": {
    params: { meetingId: string; apiBase: string; accessToken: string; language?: string };
    result: { startedAt: string };
  };
  "record.stop": { params: undefined; result: { segments: number } };
  "token.update": { params: { accessToken: string }; result: Record<string, never> };
  "detect.set": { params: { enabled: boolean }; result: Record<string, never> };
}

export type HelperCommand = keyof HelperCommands;

export interface HelperRequest<C extends HelperCommand = HelperCommand> {
  id: number;
  cmd: C;
  params?: HelperCommands[C]["params"];
}

export interface HelperError {
  code: string;
  message: string;
}

export type HelperResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: HelperError };

/** Each event name and its fields (sent flat: `{ "event": "levels", "mic": 0.2, "system": 0 }`). */
export interface HelperEvents {
  state: {
    recording: boolean;
    meetingId?: string;
    mode: "realtime" | "fallback";
    mic: ChannelHealth;
    system: ChannelHealth;
  };
  levels: { mic: number; system: number };
  "transcript.delta": { speaker: Speaker; text: string; itemId: string };
  "transcript.segment": { seq: number; speaker: Speaker; text: string; startedMs: number; endedMs: number };
  "token.needed": Record<string, never>;
  "call.started": { bundleId: string; appName: string };
  "call.ended": { bundleId: string; appName: string };
  "device.changed": { input?: string; output?: string };
  error: { code: string; message: string; fatal: boolean };
}

export type HelperEventName = keyof HelperEvents;

export type HelperEvent = {
  [K in HelperEventName]: { event: K } & HelperEvents[K];
}[HelperEventName];

/** One line from the helper: a response (has `id`) or an event (has `event`). */
export type HelperMessage = { kind: "response"; response: HelperResponse } | { kind: "event"; event: HelperEvent };

export function parseHelperLine(line: string): HelperMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === "number" && typeof obj.ok === "boolean") {
    return { kind: "response", response: obj as unknown as HelperResponse };
  }
  if (typeof obj.event === "string") return { kind: "event", event: obj as unknown as HelperEvent };
  return null;
}
