import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { SettingsScreen, useThemePreference, type ThemePreference } from "@talk/ui";
import { cleanError, api, keys } from "../api";
import {
  asUiStatus,
  hasDeviceSettings,
  permissionsFrom,
  requestPermission,
  updateDeviceSettings,
  type ExtendedSnapshot,
} from "../desktop-settings";
import { accountFrom, calendarConnectionFrom, loadable } from "../map";
import { notify } from "../notice";
import { talk, useAppState } from "../talk";

export function SettingsPage() {
  const state = useAppState() as ExtendedSnapshot | undefined;
  const me = useQuery({ queryKey: keys.me, queryFn: api.me });
  const { themePreference, setThemePreference } = useThemePreference();
  const device = state?.settings;
  // Before lane M3's settings land, the switches keep a value for this window only.
  const [local, setLocal] = useState({ launchAtLogin: false, callDetection: true });
  useEffect(() => {
    if (device) setLocal({ launchAtLogin: device.launchAtLogin, callDetection: device.callDetection });
  }, [device]);
  const permissions = permissionsFrom(state);
  const loginItem = state?.loginItem?.status;

  const change = (patch: Partial<typeof local>) => {
    setLocal((s) => ({ ...s, ...patch }));
    if (hasDeviceSettings()) {
      void updateDeviceSettings(patch).catch((e: unknown) => notify(`Couldn't save that. ${cleanError(e)}`, "error"));
    }
  };

  return (
    <SettingsScreen
      account={me.isPending && !state?.auth.email ? { status: "loading" } : accountReady(me.data, state)}
      permissions={
        state
          ? {
              status: "ready",
              data: {
                mic: permissions.mic,
                systemAudio: asUiStatus(permissions.systemAudio),
                notifications: permissions.notifications,
              },
            }
          : { status: "loading" }
      }
      calendar={loadable(me, calendarConnectionFrom)}
      launchAtLogin={local.launchAtLogin}
      detectCalls={local.callDetection}
      theme={themePreference}
      version={state?.version}
      launchAtLoginHint={
        loginItem === "requiresApproval"
          ? "Allow Talk in System Settings → General → Login Items."
          : loginItem === "unsupported"
            ? "Only in the installed app."
            : undefined
      }
      onSignOut={() => void talk["auth:signOut"]()}
      onGrant={(kind) =>
        void requestPermission(kind, permissions[kind]).catch((e: unknown) => notify(cleanError(e), "error"))
      }
      onConnectCalendar={() => void talk["calendar:connect"]()}
      onLaunchAtLoginChange={(launchAtLogin) => change({ launchAtLogin })}
      onDetectCallsChange={(callDetection) => change({ callDetection })}
      onThemeChange={(theme: ThemePreference) => {
        setThemePreference(theme);
        void updateDeviceSettings({ theme }).catch(() => {});
      }}
    />
  );
}

function accountReady(me: Parameters<typeof accountFrom>[0], state: ExtendedSnapshot | undefined) {
  const account = accountFrom(me, state?.auth);
  return account
    ? ({ status: "ready", data: account } as const)
    : ({ status: "error", message: "Couldn't load your account." } as const);
}
