import { cn } from "cn";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { selfTestLines } from "../lib/selftest";
import type { SelfTestReport } from "../types";
import { ChannelMeters } from "./recording";

export type SelfTestState =
  | { kind: "idle" }
  | { kind: "running"; levels: { mic: number; system: number } }
  | { kind: "done"; report: SelfTestReport }
  | { kind: "error"; message: string };

export interface SelfTestProps {
  state: SelfTestState;
  onRun: () => void;
  onOpenSettings: (pane: "mic" | "systemAudio") => void;
  /** Why it can't run right now (a recording). */
  disabledReason?: string;
}

const RUNNING_TEXT = "Talk to your Mac and play a video…";

/** "Test microphone & system audio": a few seconds of both sides, nothing recorded or sent. */
export function SelfTest({
  state,
  onRun,
  onOpenSettings,
  disabledReason,
}: SelfTestProps) {
  const running = state.kind === "running";
  return (
    <div data-slot="selftest" className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">
            Test microphone &amp; system audio
          </div>
          <div className="text-[12px] text-muted-foreground">
            {running
              ? RUNNING_TEXT
              : (disabledReason ??
                "A few seconds of both sides. Nothing is recorded or sent anywhere.")}
          </div>
        </div>
        {running ? (
          <ChannelMeters mic={state.levels.mic} system={state.levels.system} />
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onRun}
            disabled={!!disabledReason}
          >
            {state.kind === "idle" ? "Run test" : "Test again"}
          </Button>
        )}
      </div>
      {state.kind === "error" && (
        <p
          role="alert"
          className="flex items-start gap-2 text-[12px] text-destructive"
        >
          <XCircle className="mt-px size-3.5 shrink-0" />
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <ul aria-label="Test results" className="flex flex-col gap-1.5">
          {selfTestLines(state.report).map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]">
              {line.tone === "ok" ? (
                <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" />
              ) : line.tone === "warn" ? (
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />
              ) : (
                <XCircle className="mt-px size-3.5 shrink-0 text-destructive" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1",
                  line.tone === "ok" ? "text-foreground/80" : "text-foreground",
                )}
              >
                {line.text}
              </span>
              {line.openSettings && (
                <Button
                  size="xs"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => onOpenSettings(line.openSettings!)}
                >
                  Open Settings
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
