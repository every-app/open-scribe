// The notepad saves itself: each change waits a moment for more typing, then PUT /jottings
// sends the whole text with when it was typed (the server keeps the newest). A pending save goes
// out at once when the page changes or the window closes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Jottings } from "@shared/contract";
import { api } from "./api";
import { notify } from "./notice";
import { DebouncedSaver } from "./saver";

/** The notepad text for a meeting, starting from what's saved, saved as it changes. */
export function useJottings(
  meetingId: string,
  saved: Jottings | null | undefined,
  loaded: boolean,
): [string, (markdown: string) => void] {
  const [text, setText] = useState<{ id: string; markdown: string } | null>(null);
  const saverRef = useRef<DebouncedSaver | null>(null);

  useEffect(() => {
    const saver = new DebouncedSaver(
      (markdown, updatedAt) => api.saveJottings(meetingId, markdown, updatedAt),
      () => notify("Couldn't save your notes. They'll save on your next change.", "error"),
    );
    saverRef.current = saver;
    const onClose = () => void saver.flush();
    window.addEventListener("beforeunload", onClose);
    return () => {
      window.removeEventListener("beforeunload", onClose);
      void saver.flush();
    };
  }, [meetingId]);

  // Start from the saved text once per meeting; after that the window's text leads.
  useEffect(() => {
    if (loaded && text?.id !== meetingId) setText({ id: meetingId, markdown: saved?.markdown ?? "" });
  }, [loaded, meetingId, saved, text?.id]);

  const onChange = useCallback(
    (markdown: string) => {
      setText({ id: meetingId, markdown });
      saverRef.current?.change(markdown);
    },
    [meetingId],
  );

  return [text?.id === meetingId ? text.markdown : (saved?.markdown ?? ""), onChange];
}
