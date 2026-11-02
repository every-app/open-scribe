// The typed bridge between the renderer and main. The preload exposes `window.talk` with exactly
// these calls; main registers a handler for each `invoke` channel and validates its arguments.

import type { HelperEvent, PermissionStatus, ChannelHealth } from "./protocol";
import type { CalendarEvent, Me, MeetingDetail, MeetingPatch, MeetingSummary } from "./api";

export type TrayState = "idle" | "recording" | "attention";

export type ThemePreference = "system" | "light" | "dark";

/** The app's settings, kept by main in userData/settings.json. */
export interface Settings {
  /** Open Talk when you log in (a macOS login item). */
  launchAtLogin: boolean;
  /** Ask "Record this call?" when a call app starts using the mic (the helper's `detect.set`). */
  callDetection: boolean;
  /** How many minutes before a meeting the reminder comes, 0–30. */
  reminderLeadMinutes: number;
  /** Applied as nativeTheme.themeSource, so prefers-color-scheme follows it. */
  theme: ThemePreference;
}

export type SettingsPatch = Partial<Settings>;

export const DEFAULT_SETTINGS: Settings = {
  launchAtLogin: false,
  callDetection: true,
  reminderLeadMinutes: 1,
  theme: "system",
};

export const MAX_REMINDER_LEAD_MINUTES = 30;

/** "verified": a system-audio tap has delivered sound at least once. macOS has no API to read this
 * permission, so the helper answers "unknown" until then. */
export type SystemAudioStatus = "granted" | "denied" | "undetermined" | "verified" | "unknown";

export interface PermissionsSnapshot {
  mic: PermissionStatus;
  systemAudio: SystemAudioStatus;
  /** "granted" or "denied" once a notification has been shown or refused; "unknown" before. */
  notifications: PermissionStatus;
}

export type PermissionKind = "mic" | "systemAudio" | "notifications";

export interface LoginItemSnapshot {
  /** "requiresApproval": macOS wants the person to allow it in System Settings → General → Login
   * Items. "unsupported": an unpackaged dev run, which macOS won't register. */
  status: "enabled" | "disabled" | "requiresApproval" | "unsupported";
}

export interface AuthSnapshot {
  status: "signedOut" | "signingIn" | "signedIn";
  method?: "oauth" | "token";
  appUrl?: string;
  email?: string;
  orgName?: string;
  /** Why the last sign-in or API call failed, in words for a person. */
  error?: string;
  /** Cloudflare Access stopped a token-only request: the person must use Sign in with Every App. */
  needsEveryAppSignIn?: boolean;
}

export interface HelperSnapshot {
  status: "stopped" | "starting" | "ready" | "restarting" | "unavailable";
  version?: string;
  macos?: string;
  restarts: number;
  lastError?: string;
  permissions?: { mic: PermissionStatus; systemAudio: PermissionStatus };
}

export interface RecordingSnapshot {
  state: "idle" | "starting" | "recording" | "stopping";
  meetingId?: string;
  calendarEventId?: string;
  title?: string;
  startedAt?: string;
  mode?: "realtime" | "fallback";
  mic?: ChannelHealth;
  system?: ChannelHealth;
  /** Something the person should know that doesn't stop the recording (e.g. the fallback upload
   * fell behind and dropped some audio: helper error `fallback_backlog`). */
  warning?: string;
  /** The live transcript's last finished line. */
  lastLine?: string;
  error?: string;
}

export interface CalendarSnapshot {
  connected: boolean;
  connectUrl?: string;
  events: CalendarEvent[];
  error?: string;
  lastRefresh?: string;
}

export interface AppSnapshot {
  version: string;
  auth: AuthSnapshot;
  helper: HelperSnapshot;
  recording: RecordingSnapshot;
  calendar: CalendarSnapshot;
  tray: TrayState;
  updater: { enabled: boolean; status?: string };
  settings: Settings;
  permissions: PermissionsSnapshot;
  loginItem: LoginItemSnapshot;
}

export interface StartRecordingRequest {
  title?: string;
  calendarEventId?: string;
  /** Also open the event's call link. */
  join?: boolean;
}

/** `invoke` channels: name → [args, result]. */
export interface InvokeMap {
  "state:get": [[], AppSnapshot];
  "auth:signIn": [[appUrl: string], void];
  "auth:cancelSignIn": [[], void];
  "auth:signInWithToken": [[appUrl: string, token: string], void];
  "auth:signOut": [[], void];
  "recording:start": [[request: StartRecordingRequest], void];
  "recording:stop": [[], void];
  /** @deprecated use "permissions:request". */
  "helper:requestPermission": [[kind: "mic" | "systemAudio"], void];
  "permissions:get": [[], PermissionsSnapshot];
  "permissions:request": [[kind: PermissionKind], PermissionsSnapshot];
  "permissions:openSettings": [[pane: PermissionKind], void];
  "settings:get": [[], Settings];
  "settings:set": [[patch: SettingsPatch], Settings];
  "calendar:refresh": [[], void];
  "calendar:connect": [[], void];
  "api:me": [[], Me];
  "api:meetings": [[], MeetingSummary[]];
  "api:meeting": [[id: string], MeetingDetail];
  "api:updateMeeting": [[id: string, patch: MeetingPatch], MeetingSummary];
  "app:openInBrowser": [[meetingId?: string], void];
  /** One /api/v1 call from the window, allowlisted in main (src/main/api/routes.ts). */
  "api:call": [[method: ApiMethod, path: string, opts?: ApiCallOptions], unknown];
}

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiCallOptions {
  query?: Record<string, string>;
  body?: unknown;
}

export type InvokeChannel = keyof InvokeMap;

/** Pushes from main: name → payload. */
export interface EventMap {
  state: AppSnapshot;
  helper: HelperEvent;
}

export type EventChannel = keyof EventMap;

export type TalkBridge = {
  [C in InvokeChannel]: (...args: InvokeMap[C][0]) => Promise<InvokeMap[C][1]>;
} & {
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void;
};

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  "state:get",
  "auth:signIn",
  "auth:cancelSignIn",
  "auth:signInWithToken",
  "auth:signOut",
  "recording:start",
  "recording:stop",
  "helper:requestPermission",
  "permissions:get",
  "permissions:request",
  "permissions:openSettings",
  "settings:get",
  "settings:set",
  "calendar:refresh",
  "calendar:connect",
  "api:me",
  "api:meetings",
  "api:meeting",
  "api:updateMeeting",
  "app:openInBrowser",
  "api:call",
] as const;

export const EVENT_CHANNELS: readonly EventChannel[] = ["state", "helper"] as const;
