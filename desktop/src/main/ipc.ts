// Main's side of the typed bridge (src/shared/ipc.ts). Every handler checks that the call came
// from our own renderer and validates its arguments; the renderer gets nothing else.

import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { InvokeChannel, InvokeMap } from "@shared/ipc";
import { isAllowedApiCall, isValidApiCallOptions } from "./api/routes";

type Handler<C extends InvokeChannel> = (...args: InvokeMap[C][0]) => Promise<InvokeMap[C][1]> | InvokeMap[C][1];
export type Handlers = { [C in InvokeChannel]: Handler<C> };

export function isOurRenderer(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  if (url.startsWith("file://")) return true;
  const dev = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && !!dev && url.startsWith(dev);
}

const isString = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length <= max;

/** Argument checks per channel; a bad call is refused before the handler runs. */
const validators: { [C in InvokeChannel]: (args: unknown[]) => boolean } = {
  "state:get": (a) => a.length === 0,
  "auth:signIn": ([u]) => isString(u, 2048),
  "auth:cancelSignIn": () => true,
  "auth:signInWithToken": ([u, t]) => isString(u, 2048) && isString(t, 8192),
  "auth:signOut": () => true,
  "recording:start": ([r]) => {
    if (!r || typeof r !== "object") return false;
    const o = r as Record<string, unknown>;
    return (o.title === undefined || isString(o.title, 500)) && (o.calendarEventId === undefined || isString(o.calendarEventId, 1024)) && (o.join === undefined || typeof o.join === "boolean");
  },
  "recording:stop": () => true,
  "helper:requestPermission": ([k]) => k === "mic" || k === "systemAudio",
  "calendar:refresh": () => true,
  "calendar:connect": () => true,
  "api:me": () => true,
  "api:meetings": () => true,
  "api:meeting": ([id]) => isString(id, 256),
  "api:updateMeeting": ([id, p]) => {
    if (!isString(id, 256) || !p || typeof p !== "object") return false;
    const o = p as Record<string, unknown>;
    const keys = Object.keys(o).every((k) => k === "title" || k === "visibility");
    return keys && (o.title === undefined || isString(o.title, 500)) && (o.visibility === undefined || o.visibility === "private" || o.visibility === "team");
  },
  "app:openInBrowser": ([id]) => id === undefined || isString(id, 256),
  "api:call": ([method, path, opts, ...rest]) => rest.length === 0 && isAllowedApiCall(method, path) && isValidApiCallOptions(opts),
};

export function registerIpc(handlers: Handlers): void {
  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isOurRenderer(event)) throw new Error("Refused: not Talk's window.");
      if (!validators[channel](args)) throw new Error(`Refused: bad arguments for ${channel}.`);
      return (handlers[channel] as (...a: unknown[]) => unknown)(...args);
    });
  }
}
