// Device settings and permissions through lane M3's channels (settings:*, permissions:*). Until
// they ship, this falls back to what the bridge has today: the helper's mic/system-audio status,
// helper:requestPermission, and a theme kept in this window.

import type { AppSnapshot } from "@shared/ipc";
import type { PermissionStatus } from "@shared/protocol";
import type { ThemePreference } from "@talk/ui";
import { talk } from "./talk";

export interface DeviceSettings {
  launchAtLogin: boolean;
  callDetection: boolean;
  reminderLeadMinutes: number;
  theme: ThemePreference;
}

type Kind = "mic" | "systemAudio" | "notifications";
type SystemAudioStatus = PermissionStatus | "verified";

export interface PermissionsSnapshot {
  mic: PermissionStatus;
  systemAudio: SystemAudioStatus;
  notifications: PermissionStatus;
}

interface M3Bridge {
  "settings:get": () => Promise<DeviceSettings>;
  "settings:set": (patch: Partial<DeviceSettings>) => Promise<DeviceSettings>;
  "permissions:get": () => Promise<PermissionsSnapshot>;
  "permissions:request": (kind: Kind) => Promise<PermissionsSnapshot>;
  "permissions:openSettings": (pane: Kind) => Promise<void>;
}

/** The snapshot as M3 extends it. */
export type ExtendedSnapshot = AppSnapshot & {
  settings?: DeviceSettings;
  permissions?: PermissionsSnapshot;
  loginItem?: { status: "enabled" | "disabled" | "requiresApproval" | "unsupported" };
};

const bridge = talk as unknown as Partial<M3Bridge>;

export const hasDeviceSettings = (): boolean => typeof bridge["settings:get"] === "function";

export function permissionsFrom(state: AppSnapshot | undefined): PermissionsSnapshot {
  const extended = state as ExtendedSnapshot | undefined;
  if (extended?.permissions) return extended.permissions;
  return {
    mic: state?.helper.permissions?.mic ?? "unknown",
    systemAudio: state?.helper.permissions?.systemAudio ?? "unknown",
    notifications: "unknown",
  };
}

/** "verified" means a tap delivered sound: that's granted, as far as the window cares. */
export function asUiStatus(status: SystemAudioStatus): PermissionStatus {
  return status === "verified" ? "granted" : status;
}

export async function requestPermission(kind: Kind, current: SystemAudioStatus): Promise<void> {
  if (current === "denied") {
    if (bridge["permissions:openSettings"]) return bridge["permissions:openSettings"](kind);
    return;
  }
  if (bridge["permissions:request"]) {
    await bridge["permissions:request"](kind);
    return;
  }
  if (kind !== "notifications") await talk["helper:requestPermission"](kind);
}

export async function updateDeviceSettings(patch: Partial<DeviceSettings>): Promise<void> {
  await bridge["settings:set"]?.(patch);
}
