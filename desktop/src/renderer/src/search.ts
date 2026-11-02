// Search helpers, bridge-free for the tests.

import type { SearchField } from "@shared/contract";

/** The meeting page's tabs (MeetingTab in @talk/ui; kept here so tests don't load React code). */
export type MeetingTab = "notes" | "jottings" | "transcript";

/** Worth sending: at least one letter or digit (punctuation alone matches nothing). */
export function searchable(q: string): boolean {
  return /[\p{L}\p{N}]/u.test(q);
}

/** Open the meeting where the match is: its transcript or jottings tab; notes is the default. */
export function tabFor(field: SearchField): MeetingTab | undefined {
  return field === "transcript" ? "transcript" : field === "jottings" ? "jottings" : undefined;
}

export function parseTab(value: unknown): MeetingTab | undefined {
  return value === "notes" || value === "jottings" || value === "transcript" ? value : undefined;
}
