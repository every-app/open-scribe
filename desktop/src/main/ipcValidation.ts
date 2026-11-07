// Argument checks for every invoke channel (src/shared/ipc.ts). The renderer is untrusted: a call
// whose arguments don't pass is refused before its handler runs. No Electron import (tested).

import type { InvokeChannel, PermissionKind } from "@shared/ipc";
import { isAllowedApiCall, isValidApiCallOptions } from "./api/routes";
import { looksLikeLink } from "./clipboard";
import { parseSettingsPatch } from "./settings";

const isPermissionKind = (v: unknown): v is PermissionKind => v === "mic" || v === "systemAudio" || v === "notifications";

/** { seconds?: whole 2–15, echoCancellation?: boolean }, nothing else. (The helper takes 1–60;
 * the window's test button needs no more than this.) */
function isSelfTestRequest(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "seconds" && k !== "echoCancellation")) return false;
  if (o.seconds !== undefined && !(Number.isInteger(o.seconds) && (o.seconds as number) >= 2 && (o.seconds as number) <= 15)) return false;
  return o.echoCancellation === undefined || typeof o.echoCancellation === "boolean";
}

const isString = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length <= max;

/** Argument checks per channel; a bad call is refused before the handler runs. */
export const validators: { [C in InvokeChannel]: (args: unknown[]) => boolean } = {
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
  "helper:requestPermission": (a) => a.length === 1 && (a[0] === "mic" || a[0] === "systemAudio"),
  "permissions:get": (a) => a.length === 0,
  "permissions:request": (a) => a.length === 1 && isPermissionKind(a[0]),
  "permissions:openSettings": (a) => a.length === 1 && isPermissionKind(a[0]),
  "settings:get": (a) => a.length === 0,
  "settings:set": (a) => a.length === 1 && parseSettingsPatch(a[0]) !== null,
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
  "clipboard:writeText": (a) => a.length === 1 && looksLikeLink(a[0]),
  "update:install": (a) => a.length === 0,
  "pill:get": (a) => a.length === 0,
  "pill:openMeeting": (a) => a.length === 0,
  "selftest:run": (a) => a.length === 0 || (a.length === 1 && (a[0] === undefined || isSelfTestRequest(a[0]))),
};

/** True when `args` are acceptable for `channel` (also exported for tests). */
export function validArgs(channel: InvokeChannel, args: unknown[]): boolean {
  if (!Object.hasOwn(validators, channel)) return false;
  return validators[channel](args);
}

