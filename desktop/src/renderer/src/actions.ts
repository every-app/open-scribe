import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import type { RecordingSnapshot, StartRecordingRequest } from "@shared/ipc";
import { api, cleanError, keys } from "./api";
import { notify } from "./notice";
import { wasCancelledStart } from "./recording";
import { talk } from "./talk";

/** Run a change, refresh what it touched, and say so if it failed. */
export function useRun() {
  const client = useQueryClient();
  return useCallback(
    async (work: () => Promise<unknown>, failed: string, touched: readonly (readonly unknown[])[] = []) => {
      try {
        await work();
      } catch (error) {
        notify(`${failed} ${cleanError(error)}`.trim(), "error");
      } finally {
        await Promise.all(touched.map((queryKey) => client.invalidateQueries({ queryKey })));
      }
    },
    [client],
  );
}

/**
 * Start taking notes (main creates the meeting and starts the helper), then open the meeting.
 * Jottings typed before the call are saved onto it.
 */
export function useStartRecording() {
  const navigate = useNavigate();
  const client = useQueryClient();
  return useCallback(
    async (request: StartRecordingRequest, jottings?: string) => {
      try {
        await talk["recording:start"](request);
      } catch (error) {
        notify(cleanError(error), "error");
        return false;
      }
      const meetingId = (await talk["state:get"]()).recording.meetingId;
      void client.invalidateQueries({ queryKey: keys.allMeetings });
      // No meeting: it was stopped while starting (or another one took over). Nothing started.
      if (!meetingId) return false;
      if (jottings?.trim()) {
        await api.saveJottings(meetingId, jottings, new Date().toISOString()).catch(() => {
          notify("Couldn't carry over the notes you wrote before the call.", "error");
        });
      }
      await navigate({ to: "/meetings/$id", params: { id: meetingId } });
      return true;
    },
    [client, navigate],
  );
}

export function useStopRecording() {
  const client = useQueryClient();
  return useCallback(async () => {
    const meetingId = (await talk["state:get"]()).recording.meetingId;
    try {
      await talk["recording:stop"]();
    } catch (error) {
      notify(cleanError(error), "error");
    }
    if (meetingId) void client.invalidateQueries({ queryKey: keys.meeting(meetingId) });
    void client.invalidateQueries({ queryKey: keys.allMeetings });
  }, [client]);
}

/** Before-call notes for a calendar event, kept in this window until recording starts. */
export const draftKey = (eventId: string) => `talk.prejottings.${eventId}`;

/**
 * When a stop cancels a recording that was still starting: nothing was recorded, so the window
 * returns to the before-meeting page if you were looking at that call (your before-call notes
 * are still there).
 */
export function useCancelledStart() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const prevRef = useRef<RecordingSnapshot | undefined>(undefined);

  return useCallback(
    (next: RecordingSnapshot) => {
      const prev = prevRef.current;
      prevRef.current = next;
      if (!prev || !wasCancelledStart(prev, next)) return;
      const { meetingId, calendarEventId } = prev;
      notify("Stopped before it started. Nothing was recorded.");
      const here = pathRef.current;
      const watching =
        here === "/" ||
        (meetingId && here === `/meetings/${meetingId}`) ||
        (calendarEventId && here === `/upcoming/${calendarEventId}`);
      const goBack = () => {
        if (!watching) return;
        if (calendarEventId) void navigate({ to: "/upcoming/$eventId", params: { eventId: calendarEventId } });
        else if (here !== "/") void navigate({ to: "/" });
      };
      goBack();
      // The empty meeting is main's to clean up (it works with the window closed); refresh lists.
      void client.invalidateQueries({ queryKey: keys.allMeetings });
    },
    [client, navigate],
  );
}
