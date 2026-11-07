// The floating recorder's page (pill.html, src/main/pillWindow.ts). Main decides where things
// sit and whether the panel is open; this draws it, moves the meter with the helper's `levels`,
// and asks main to open the meeting on a click.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FloatingRecorder, meterLevel } from "@talk/ui";
import type { PillView } from "@shared/ipc";
import { LEVELS_STALE_MS, pillNotice } from "./view";
import "./pill.css";

const talk = window.talk;

function usePillView(): PillView | undefined {
  const [view, setView] = useState<PillView>();
  useEffect(() => {
    let pushed = false;
    const off = talk.on("pill", (v) => {
      pushed = true;
      setView(v);
    });
    void talk["pill:get"]().then((v) => {
      if (!pushed) setView(v);
    });
    return off;
  }, []);
  return view;
}

function useLevel(): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let stale: ReturnType<typeof setTimeout> | undefined;
    const off = talk.on("helper", (event) => {
      if (event.event !== "levels") return;
      setLevel(meterLevel(event.mic, event.system));
      clearTimeout(stale);
      stale = setTimeout(() => setLevel(0), LEVELS_STALE_MS);
    });
    return () => {
      off();
      clearTimeout(stale);
    };
  }, []);
  return level;
}

function Pill() {
  const view = usePillView();
  const level = useLevel();
  if (!view) return null;
  return (
    <FloatingRecorder
      layout={view.layout}
      expanded={view.expanded}
      level={level}
      stopping={view.recording.state === "stopping"}
      segments={view.transcript.segments}
      pending={view.transcript.pending}
      notice={pillNotice(view.recording)}
      onOpen={() => void talk["pill:openMeeting"]()}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Pill />
  </StrictMode>,
);
