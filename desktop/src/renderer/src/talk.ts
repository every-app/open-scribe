// React hooks over the preload bridge. Screens use these (and TanStack Query for /api/v1 data),
// never `window.talk` directly, so the bridge can be mocked in renderer tests later.

import { useEffect, useState } from "react";
import type { AppSnapshot } from "@shared/ipc";
import type { HelperEvent } from "@shared/protocol";

export const talk = window.talk;

export function useAppState(): AppSnapshot | undefined {
  const [state, setState] = useState<AppSnapshot>();
  useEffect(() => {
    let live = true;
    void talk["state:get"]().then((s) => live && setState(s));
    const off = talk.on("state", setState);
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

export function useHelperEvents(listener: (event: HelperEvent) => void): void {
  useEffect(() => talk.on("helper", listener), [listener]);
}
