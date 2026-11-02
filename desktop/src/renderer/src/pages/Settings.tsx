import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PermissionKind } from "@shared/ipc";
import { SettingsScreen, useThemePreference, type ThemePreference } from "@talk/ui";
import { api, cleanError, keys } from "../api";
import { useDeviceSettings } from "../device-settings";
import { accountFrom, calendarConnectionFrom, loadable } from "../map";
import { notify } from "../notice";
import { grantPermission, loginItemHint, uiPermissions } from "../settings-logic";
import { talk, useAppState } from "../talk";

const granted: Record<PermissionKind, string> = {
  mic: "Microphone is on.",
  systemAudio: "System audio is on.",
  notifications: "Notifications are on.",
};

export function SettingsPage() {
  const state = useAppState();
  const me = useQuery({ queryKey: keys.me, queryFn: api.me });
  const { themePreference, setThemePreference } = useThemePreference();
  const { settings, set } = useDeviceSettings();
  const [hints, setHints] = useState<Partial<Record<PermissionKind, string>>>({});
  const permissions = uiPermissions(state?.permissions);

  const change = (patch: Parameters<typeof set>[0]) =>
    void set(patch).catch((e: unknown) => notify(`Couldn't save that. ${cleanError(e)}`, "error"));

  const account = accountFrom(me.data, state?.auth);

  return (
    <SettingsScreen
      account={
        account
          ? { status: "ready", data: account }
          : me.isPending
            ? { status: "loading" }
            : { status: "error", message: "Couldn't load your account." }
      }
      permissions={state ? { status: "ready", data: permissions } : { status: "loading" }}
      permissionHints={hints}
      calendar={loadable(me, calendarConnectionFrom)}
      launchAtLogin={settings?.launchAtLogin ?? false}
      detectCalls={settings?.callDetection ?? true}
      echoCancellation={settings?.echoCancellation}
      recordShortcut={settings?.recordShortcut}
      recordShortcutStatus={state?.recordShortcut}
      onRecordShortcutChange={(recordShortcut) => change({ recordShortcut })}
      theme={themePreference}
      version={state?.version}
      launchAtLoginHint={loginItemHint(state?.loginItem?.status, settings?.launchAtLogin ?? false)}
      onSignOut={() => void talk["auth:signOut"]()}
      onGrant={(kind) =>
        void grantPermission(talk, kind, permissions[kind]).then(
          ({ status, hint }) => {
            setHints((h) => ({ ...h, [kind]: hint }));
            if (status === "granted") notify(granted[kind]);
          },
          (e: unknown) => notify(cleanError(e), "error"),
        )
      }
      onOpenSystemSettings={(kind) => void talk["permissions:openSettings"](kind).catch((e: unknown) => notify(cleanError(e), "error"))}
      onConnectCalendar={() => void talk["calendar:connect"]()}
      onLaunchAtLoginChange={(launchAtLogin) => change({ launchAtLogin })}
      onDetectCallsChange={(callDetection) => change({ callDetection })}
      onEchoCancellationChange={(echoCancellation) => change({ echoCancellation })}
      onThemeChange={(theme: ThemePreference) => {
        setThemePreference(theme);
        change({ theme });
      }}
    />
  );
}
