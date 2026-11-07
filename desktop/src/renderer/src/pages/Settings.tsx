import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PermissionKind } from "@shared/ipc";
import { SettingsScreen, useThemePreference, type SelfTestState, type ThemePreference } from "@talk/ui";
import { api, cleanError, keys } from "../api";
import { useDeviceSettings } from "../device-settings";
import { accountFrom, calendarConnectionFrom, loadable } from "../map";
import { notify } from "../notice";
import { grantPermission, loginItemHint, selfTestBlockedReason, uiPermissions } from "../settings-logic";
import { useLevels } from "../live";
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
  const [test, setTest] = useState<SelfTestState>({ kind: "idle" });
  const levels = useLevels(); // the helper's levels, live while the test runs
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
      floatingRecorder={settings?.floatingRecorder}
      onFloatingRecorderChange={(floatingRecorder) => change({ floatingRecorder })}
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
      selfTest={{
        state: test.kind === "running" ? { kind: "running", levels } : test,
        disabledReason: selfTestBlockedReason(state, test.kind === "running"),
        onRun: () => {
          setTest({ kind: "running", levels: { mic: 0, system: 0 } });
          void talk["selftest:run"]().then(
            (report) => setTest({ kind: "done", report }),
            (e: unknown) => setTest({ kind: "error", message: cleanError(e) }),
          );
        },
        onOpenSettings: (pane) =>
          void talk["permissions:openSettings"](pane).catch((e: unknown) => notify(cleanError(e), "error")),
      }}
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
