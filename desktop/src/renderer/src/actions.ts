import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { StartRecordingRequest } from "@shared/ipc";
import { api, cleanError, keys } from "./api";
import { notify } from "./notice";
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
      if (!meetingId) return true;
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
