// React hooks over the preload bridge. Screens use these (and TanStack Query for /api/v1 data),
// never `window.talk` directly, so the bridge can be mocked in renderer tests.

import { useSyncExternalStore } from "react";
import type { AppSnapshot } from "@shared/ipc";
import { applyHelperEvent } from "./live";

export const talk = window.talk;

// One subscription for the whole window: the app snapshot and the helper's live events.
let snapshot: AppSnapshot | undefined;
const listeners = new Set<() => void>();
let started = false;

function setSnapshot(next: AppSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

/** Start listening to main; call once at startup. */
export function connectBridge(): void {
  if (started) return;
  started = true;
  void talk["state:get"]().then(setSnapshot);
  talk.on("state", setSnapshot);
  talk.on("helper", applyHelperEvent);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): AppSnapshot | undefined {
  return useSyncExternalStore(subscribe, () => snapshot);
}
