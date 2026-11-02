/**
 * What a self-test report says, side by side, in words for a person, with the System Settings
 * pane to offer when a permission is the likely cause.
 */
import type { SelfTestReport, SelfTestSide } from "../types";

export interface SelfTestLine {
  side: "mic" | "system";
  tone: "ok" | "warn" | "bad";
  text: string;
  /** Offer "Open Settings" for this permission. */
  openSettings?: "mic" | "systemAudio";
}

const device = (s: SelfTestSide) => (s.device ? ` (${s.device})` : "");

export function selfTestLines(report: SelfTestReport): SelfTestLine[] {
  const lines: SelfTestLine[] = [];
  const { mic, system } = report;

  if (mic.status === "ok")
    lines.push({
      side: "mic",
      tone: "ok",
      text: `Your microphone works${device(mic)}.`,
    });
  else if (mic.status === "denied")
    lines.push({
      side: "mic",
      tone: "bad",
      text: "Microphone access is off for Talk.",
      openSettings: "mic",
    });
  else if (mic.status === "silent")
    lines.push({
      side: "mic",
      tone: "warn",
      text: `Your microphone is very quiet${device(mic)}. Speak up, or check the input device in System Settings → Sound.`,
    });
  else
    lines.push({
      side: "mic",
      tone: "bad",
      text: mic.message ?? "The microphone test didn't work.",
    });
  if (mic.clipping)
    lines.push({
      side: "mic",
      tone: "warn",
      text: "Your mic is too loud: turn its input level down in System Settings → Sound.",
    });
  if (mic.dropouts > 0)
    lines.push({
      side: "mic",
      tone: "warn",
      text: "Some of your microphone's audio dropped out.",
    });

  if (system.status === "ok")
    lines.push({
      side: "system",
      tone: "ok",
      text: "Talk hears your Mac's sound.",
    });
  else if (system.status === "denied")
    lines.push({
      side: "system",
      tone: "bad",
      text: "No sound from your Mac. Play a video while testing, or allow Talk under System Settings → Privacy & Security → Screen & System Audio Recording.",
      openSettings: "systemAudio",
    });
  else if (system.status === "silent")
    lines.push({
      side: "system",
      tone: "warn",
      text: "Your Mac's sound came through very quietly. Turn the volume up while testing.",
    });
  else
    lines.push({
      side: "system",
      tone: "bad",
      text: system.message ?? "The system audio test didn't work.",
    });
  if (system.dropouts > 0)
    lines.push({
      side: "system",
      tone: "warn",
      text: "Some of your Mac's audio dropped out.",
    });

  return lines;
}
