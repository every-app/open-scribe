// Reading the recording snapshot's transitions. Pure, for the tests.

import type { RecordingSnapshot } from "@shared/ipc";

/** The wording for a `fallback_backlog` warning; the helper's own message goes in the tooltip. */
export const SLOW_CONNECTION = "Connection is slow, some audio may be skipped.";

/**
 * A stop while the recording was still starting: main goes back to idle without an error and
 * without the recording ever having started (no `startedAt`).
 */
export function wasCancelledStart(prev: RecordingSnapshot | undefined, next: RecordingSnapshot): boolean {
  if (!prev || next.state !== "idle" || next.error) return false;
  return (prev.state === "starting" || prev.state === "stopping") && !prev.startedAt;
}
