// The live view of a recording, from the helper's events: levels (≤10 Hz), text still being
// spoken (`transcript.delta`, which carries the whole turn so far for its itemId) and committed
// turns (`transcript.segment`). The reducer is pure for the tests; the store feeds React.

import { useSyncExternalStore } from "react";
import type { Segment } from "@shared/contract";
import type { HelperEvent, Speaker } from "@shared/protocol";

export interface LiveTranscript {
  /** The meeting these belong to (from the helper's `state` event). */
  meetingId?: string;
  segments: Segment[];
  /** Turns still being spoken, by itemId, in arrival order. */
  pending: { itemId: string; speaker: Speaker; text: string }[];
}

export const emptyTranscript: LiveTranscript = { segments: [], pending: [] };

export function reduceTranscript(state: LiveTranscript, event: HelperEvent): LiveTranscript {
  switch (event.event) {
    case "state":
      // A new recording starts clean.
      if (event.meetingId && event.meetingId !== state.meetingId) return { ...emptyTranscript, meetingId: event.meetingId };
      return state;
    case "transcript.delta": {
      const at = state.pending.findIndex((p) => p.itemId === event.itemId);
      const item = { itemId: event.itemId, speaker: event.speaker, text: event.text };
      const pending = at === -1 ? [...state.pending, item] : state.pending.map((p, i) => (i === at ? item : p));
      return { ...state, pending };
    }
    case "transcript.segment": {
      if (state.segments.some((s) => s.seq === event.seq)) return state;
      const segment: Segment = {
        seq: event.seq,
        speaker: event.speaker,
        text: event.text,
        startedMs: event.startedMs,
        endedMs: event.endedMs,
      };
      // The committed turn replaces that speaker's oldest text in flight.
      const done = state.pending.findIndex((p) => p.speaker === event.speaker);
      return {
        ...state,
        segments: [...state.segments, segment].sort((a, b) => a.seq - b.seq),
        pending: done === -1 ? state.pending : state.pending.filter((_, i) => i !== done),
      };
    }
    default:
      return state;
  }
}

/** Text in flight per speaker, as the transcript view wants it. */
export function partialOf(state: LiveTranscript): { me: string; them: string } {
  const join = (speaker: Speaker) =>
    state.pending
      .filter((p) => p.speaker === speaker)
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join(" ");
  return { me: join("me"), them: join("them") };
}

/** The API's segments plus the live ones the API hasn't caught up with, by seq. */
export function mergeSegments(saved: Segment[], live: Segment[]): Segment[] {
  const seen = new Set(saved.map((s) => s.seq));
  return [...saved, ...live.filter((s) => !seen.has(s.seq))].sort((a, b) => a.seq - b.seq);
}

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (next === value) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const levels = store({ mic: 0, system: 0 });
const transcript = store<LiveTranscript>(emptyTranscript);

/** Feed one helper event into the stores. */
export function applyHelperEvent(event: HelperEvent): void {
  if (event.event === "levels") levels.set({ mic: event.mic, system: event.system });
  else transcript.set(reduceTranscript(transcript.get(), event));
}

export function useLevels(): { mic: number; system: number } {
  return useSyncExternalStore(levels.subscribe, levels.get);
}

export function useLiveTranscript(): LiveTranscript {
  return useSyncExternalStore(transcript.subscribe, transcript.get);
}
