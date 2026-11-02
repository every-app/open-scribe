// The menu-bar icon: idle (waveform), recording (filled square with the waveform cut out), needs
// attention (waveform with a dot), all template images drawn by scripts/make-icons.mjs, and a
// menu with Open Talk, Start recording, Stop, Quit.

import { app, Menu, nativeImage, Tray, type NativeImage } from "electron";
import { join } from "node:path";
import type { AppSnapshot, TrayState } from "@shared/ipc";

export interface TrayActions {
  open(): void;
  start(): void;
  stop(): void;
  quit(): void;
}

function icon(name: string): NativeImage {
  const image = nativeImage.createFromPath(join(app.getAppPath(), "resources", "tray", `${name}.png`));
  if (name.endsWith("Template")) image.setTemplateImage(true);
  return image;
}

export function trayStateFor(s: Pick<AppSnapshot, "auth" | "helper" | "recording">): TrayState {
  if (s.recording.state === "recording" || s.recording.state === "starting" || s.recording.state === "stopping") return "recording";
  const helperDown = s.helper.status === "unavailable" || s.helper.status === "restarting";
  const micDenied = s.helper.permissions?.mic === "denied";
  if (s.auth.status === "signedOut" || s.auth.needsEveryAppSignIn || helperDown || micDenied || s.recording.error) return "attention";
  return "idle";
}

export class TrayController {
  private tray: Tray | undefined;
  private icons: Record<TrayState, NativeImage> | undefined;
  private lastKey = "";

  constructor(private readonly actions: TrayActions) {}

  create(): void {
    this.icons = { idle: icon("idleTemplate"), recording: icon("recordingTemplate"), attention: icon("attentionTemplate") };
    this.tray = new Tray(this.icons.idle);
    this.tray.setToolTip("Talk");
  }

  update(s: AppSnapshot): void {
    const tray = this.tray;
    if (!tray || !this.icons) return;
    const key = JSON.stringify([s.tray, s.auth.status, s.auth.email, s.recording.state, s.recording.title, s.recording.lastLine, s.recording.warning, s.recording.error, s.helper.status]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    tray.setImage(this.icons[s.tray]);
    const r = s.recording;
    const busy = r.state !== "idle";
    const signedIn = s.auth.status === "signedIn";
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (busy) {
      items.push({ label: r.state === "recording" ? `● Recording: ${r.title ?? ""}` : r.state === "starting" ? "Starting…" : "Saving…", enabled: false });
      if (r.warning) items.push({ label: `⚠ ${truncate(r.warning, 58)}`, enabled: false });
      if (r.lastLine) items.push({ label: truncate(r.lastLine, 60), enabled: false });
    } else if (r.error) {
      items.push({ label: truncate(r.error, 60), enabled: false });
    } else if (!signedIn) {
      items.push({ label: "Not signed in", enabled: false });
    } else if (s.helper.status !== "ready") {
      items.push({ label: s.helper.lastError ? truncate(s.helper.lastError, 60) : "Recorder starting…", enabled: false });
    }
    items.push(
      { type: "separator" },
      { label: "Open Talk", click: () => this.actions.open() },
      { label: "Start Recording", enabled: signedIn && !busy && s.helper.status === "ready", click: () => this.actions.start() },
      { label: "Stop Recording", enabled: r.state === "recording" || r.state === "starting", click: () => this.actions.stop() },
      { type: "separator" },
      { label: "Quit Talk", accelerator: "Command+Q", click: () => this.actions.quit() },
    );
    tray.setContextMenu(Menu.buildFromTemplate(items));
    tray.setToolTip(s.tray === "recording" ? "Talk: recording" : s.tray === "attention" ? "Talk: needs attention" : "Talk");
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
