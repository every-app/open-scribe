// Talk's main process: sign-in and tokens, the tray, the window, calendar prompts, the updater,
// and the helper supervisor. The renderer reaches it only through the typed preload bridge.

import { app, BrowserWindow, clipboard, dialog, globalShortcut, net, Notification, powerMonitor, session, shell, safeStorage } from "electron";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { AppSnapshot, LoginItemSnapshot, PermissionKind, StartRecordingRequest } from "@shared/ipc";
import type { CalendarEvent } from "@shared/api";
import { AuthService } from "./auth/service";
import { SecretStore } from "./auth/store";
import { errorMessage } from "./auth/oauth";
import { CalendarService } from "./calendar/service";
import { parseTalkUrl, resolveTalkUrl } from "./calendar/talkUrl";
import { PromptLedger } from "./calendar/ledger";
import { devSignIn, helperPath, isDevFlavor, keychainDisabled } from "./config";
import { HelperSupervisor } from "./helper/supervisor";
import { registerIpc } from "./ipc";
import { isCopyableUrl, normalizedLink } from "./clipboard";
import { log, logPath, logTail } from "./log";
import { Connectivity } from "./connectivity";
import { PendingUploads } from "./pending";
import { buildDiagnostics } from "./diagnostics";
import { RecordingController } from "./recording";
import { TrayController, trayStateFor } from "./tray";
import { createUpdater } from "./updater";
import type { UpdateController } from "./updates";
import { RecordShortcut } from "./shortcut";
import { MainWindow } from "./window";
import { AppMenu } from "./menu";
import { typedAppUrl } from "./auth/url";
import { guardNavigation, type AppOrigin } from "./navigation";
import { helperIdentity, PermissionProbe } from "./permissions";
import { SettingsStore } from "./settings";
import { applyLoginItem, applyTheme, loginItemStatus, requestNotificationPermission, settingsPaneUrl } from "./system";

// `electron-vite dev` runs as "Talk Dev" too: its own userData and its own "Talk Dev Safe Storage"
// Keychain item, apart from any installed Talk.
// An explicit --user-data-dir (a test driver's throwaway profile) wins, so it never shares the
// installed Talk Dev's userData or single-instance lock.
if (!app.isPackaged) {
  app.setName("Talk Dev");
  if (!app.commandLine.hasSwitch("user-data-dir")) app.setPath("userData", join(app.getPath("appData"), "Talk Dev"));
  // A throwaway profile keeps its logs too, out of the installed Talk Dev's ~/Library/Logs.
  else app.setAppLogsPath(join(app.getPath("userData"), "logs"));
}

/** Talk's own page: the bundled renderer, or the electron-vite dev server in an unpackaged run.
 * Navigation guards and IPC sender checks both use it. */
const origin: AppOrigin = {
  rendererFile: join(__dirname, "../renderer/index.html"),
  devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
};

/** A dev build owns `talk-dev://`, so it never takes links meant for the installed Talk. */
const URL_SCHEMES = isDevFlavor() ? ["talk-dev"] : ["talk"];
const pendingUrls: string[] = [];
let handleUrl: ((url: string) => void) | undefined;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (handleUrl) handleUrl(url);
    else pendingUrls.push(url);
  });
  // Only Talk's own page loads in a window; https links go to the browser; no webviews.
  app.on("web-contents-created", (_e, contents) => {
    guardNavigation(contents, origin, (url) => void shell.openExternal(url), log);
  });
  void app.whenReady().then(main);
}

async function main(): Promise<void> {
  log(`Talk ${app.getVersion()} (${app.getName()}) starting; packaged ${app.isPackaged}`);
  // The renderer needs no device or other permission; the helper does the capturing.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"), log);
  settings.load();
  applyTheme(settings.value.theme);
  const probe = new PermissionProbe(join(app.getPath("userData"), "permissions.json"), log);
  probe.load();
  // The login item can be removed in System Settings: what macOS says wins over the saved setting.
  let loginItem: LoginItemSnapshot = loginItemStatus();
  if (loginItem.status === "enabled" && !settings.value.launchAtLogin) settings.set({ launchAtLogin: true });
  if (loginItem.status === "disabled" && settings.value.launchAtLogin) settings.set({ launchAtLogin: false });

  const noKeychain = keychainDisabled();
  if (noKeychain) log("dev: the Keychain is off; sign-ins last until quit (TALK_DEV_KEYCHAIN=1 to keep them)");
  const store = new SecretStore(
    join(app.getPath("userData"), "signin.bin"),
    {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data),
    },
    noKeychain,
  );
  let connectivity: Connectivity | undefined;
  const auth = new AuthService({
    store,
    openBrowser: (url) => shell.openExternal(url),
    log,
    onApiOutcome: (error) => connectivity?.report(error),
  });
  connectivity = new Connectivity({
    probe: async () => {
      const api = auth.api;
      if (!api) return undefined;
      try {
        await api.me();
        return undefined;
      } catch (error) {
        auth.handleError(error);
        return error;
      }
    },
    signedIn: () => auth.state.status === "signedIn",
    log,
  });
  const online = connectivity;
  const pending = new PendingUploads(join(app.getPath("userData"), "pending"), log);

  const helper = new HelperSupervisor({
    path: helperPath(),
    freshToken: () => auth.freshAccessToken(),
    log,
  });
  const recording = new RecordingController(auth, helper, log, () => settings.value.echoCancellation);
  recording.saveFailuresExpected = () => online.state !== "online";
  /** Sends what earlier recordings couldn't save, when the app is reachable and signed in. */
  const replayPending = async () => {
    const api = auth.api;
    if (!api || online.state !== "online") return;
    try {
      await pending.replay(api);
    } catch (error) {
      log(`pending replay failed: ${errorMessage(error)}`);
    }
  };
  const window = new MainWindow(join(__dirname, "../preload/index.js"));

  let updates: UpdateController | undefined;
  /** Restart into a downloaded update. The window hides instead of closing, so mark the quit
   * first, or the updater would wait for it forever; during a recording the controller defers. */
  const installUpdate = (): { deferred: boolean } => {
    if (!updates) return { deferred: false };
    if (!recording.isActive && updates.state.state === "ready") window.quitting = true;
    const result = updates.install();
    if (result.deferred) calendar.notify("Update after this recording", "Talk will offer to restart when you stop recording.");
    return result;
  };

  const notifyError = (title: string, error: unknown) => calendar.notify(title, errorMessage(error));

  const startRecording = async (req: StartRecordingRequest & { event?: CalendarEvent }) => {
    const event = req.event ?? (req.calendarEventId ? calendar.state.events.find((e) => e.id === req.calendarEventId) : undefined);
    if (req.join && event?.conferenceUrl?.startsWith("https://")) void shell.openExternal(event.conferenceUrl);
    const options = event
      ? RecordingController.titleFor(event)
      : { title: req.title?.trim() || RecordingController.nowTitle(), calendarEventId: req.calendarEventId };
    await recording.start(options);
    if (options.calendarEventId) calendar.clear(options.calendarEventId);
  };

  const calendar = new CalendarService(
    auth,
    {
      takeNotes: (event, join) => void startRecording({ event, join }).catch((e) => notifyError("Talk couldn't start", e)),
      recordCall: (appName) =>
        void startRecording({ title: `${appName} call` }).catch((e) => notifyError("Talk couldn't start", e)),
      isRecording: () => recording.isActive,
      recordingEventId: () => (recording.isActive ? recording.state.calendarEventId : undefined),
      reminderLeadMs: () => settings.value.reminderLeadMinutes * 60_000,
      notificationResult: (shown) => probe.notificationResult(shown),
    },
    log,
    new PromptLedger(join(app.getPath("userData"), "prompts.json")).load(),
  );

  const tray = new TrayController({
    open: () => window.show(),
    start: () => void startRecording({}).catch((e) => notifyError("Talk couldn't start", e)),
    stop: () => void recording.stop().catch((e) => notifyError("Talk couldn't stop", e)),
    quit: () => app.quit(),
    installUpdate: () => void installUpdate(),
  });

  /** ⌃⌥⌘R from anywhere (the setting is off by default): start a recording, or stop the one running. */
  const shortcut = new RecordShortcut(
    {
      register: (accelerator, fn) => globalShortcut.register(accelerator, fn),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    () => {
      if (recording.isActive) void recording.stop().catch((e) => notifyError("Talk couldn't stop", e));
      else void startRecording({}).catch((e) => notifyError("Talk couldn't start", e));
    },
    log,
  );
  app.on("will-quit", () => shortcut.set(false));

  /** About Talk: the app and recorder versions (from the helper's hello). */
  const setAbout = () =>
    app.setAboutPanelOptions({
      applicationName: app.getName(),
      applicationVersion: app.getVersion(),
      version: helper.state.version ? `recorder ${helper.state.version}` : "recorder not running",
      copyright: "Every App",
      credits: "Help → Copy Diagnostics copies what support needs.",
    });
  setAbout();

  const menu = new AppMenu({
    open: () => window.show(),
    settings: () => window.showAndSend("navigate", { to: "settings" }),
    start: () => void startRecording({}).catch((e) => notifyError("Talk couldn't start", e)),
    stop: () => void recording.stop().catch((e) => notifyError("Talk couldn't stop", e)),
    checkForUpdates: () => {
      if (!updates) return;
      void updates.check(true).then(() => {
        const u = updates?.state;
        if (u?.state === "upToDate") calendar.notify("Talk is up to date", `You have ${app.getVersion()}.`);
        else if (u?.state === "error") calendar.notify("Couldn't check for updates", u.error ?? "");
      });
    },
    installUpdate: () => void installUpdate(),
    showLogs: () => {
      const path = logPath();
      if (path) shell.showItemInFolder(path);
    },
    copyDiagnostics: () => {
      clipboard.writeText(
        buildDiagnostics({
          snapshot: snapshot(),
          versions: {
            app: app.getVersion(),
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
            os: `${process.platform} ${process.getSystemVersion()}`,
            arch: process.arch,
          },
          recordingCrashes: recording.crashCount,
          pendingUploads: pending.count,
          logTail: logTail(50),
        }),
      );
      log("diagnostics copied to the clipboard");
    },
  });

  const snapshot = (): AppSnapshot => {
    const s = {
      version: app.getVersion(),
      auth: auth.state,
      helper: helper.state,
      recording: recording.state,
      calendar: calendar.state,
      updater: updates?.state ?? { enabled: false, state: "idle" as const },
      recordShortcut: shortcut.status,
      settings: settings.value,
      connection: online.state,
      permissions: probe.snapshot(helper.state.permissions),
      loginItem,
    };
    return { ...s, tray: trayStateFor(s) };
  };
  let queued = false;
  const broadcast = () => {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      const s = snapshot();
      tray.update(s);
      menu.update(s);
      window.send("state", s);
    });
  };

  let wasSignedIn = false;
  let restoredPrompts = false;
  /** Call detection runs while signed in, if the setting is on. */
  const syncDetection = () => void helper.setDetection(wasSignedIn && settings.value.callDetection).catch(() => {});
  auth.on("change", (a) => {
    const signedIn = a.status === "signedIn";
    online.setSignInNeeded(!!a.expired || !!a.needsEveryAppSignIn);
    if (signedIn && !wasSignedIn) {
      void auth.loadMe();
      // Signed in again during a recording (after an expiry): unblock the helper's posts now.
      if (recording.isActive) {
        void auth
          .accessToken()
          .then(async (accessToken) => {
            if (accessToken) await helper.request("token.update", { accessToken });
          })
          .catch((e) => log(`token.update after sign-in failed: ${errorMessage(e)}`));
      }
      void replayPending();
      calendar.start();
      if (!restoredPrompts) {
        restoredPrompts = true;
        void calendar.restoreDelivered();
      }
      wasSignedIn = true;
      syncDetection();
    } else if (!signedIn && wasSignedIn) {
      calendar.stop();
      wasSignedIn = false;
      syncDetection();
      if (a.expired) {
        // Not the person's choice: keep recording. The helper queues segments until a new sign-in
        // sends token.update; the window asks to sign in again in place.
        log("sign-in expired; waiting for a new sign-in" + (recording.isActive ? " (the recording continues)" : ""));
      } else {
        online.reset();
        if (recording.isActive) void recording.stop().catch(() => {});
      }
    }
    wasSignedIn = signedIn;
    broadcast();
  });
  let loggedPermissions = "";
  let helperHello = "";
  helper.on("status", (h) => {
    // A (re)started helper said hello: key "system audio verified" to this binary, and never let
    // the fake helper's made-up levels count.
    const hello = h.status === "ready" ? `${h.version}|${h.macos}|${h.restarts}` : "";
    if (hello && hello !== helperHello) {
      const path = helperPath();
      let stat: { size?: number; mtimeMs?: number } = {};
      try {
        const st = statSync(path);
        stat = { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        // Gone: no identity, so nothing counts.
      }
      probe.setHelper(helperIdentity({ path, ...stat, version: h.version, macos: h.macos }));
      setAbout();
    }
    helperHello = hello || helperHello;
    const key = JSON.stringify(h.permissions ?? null);
    if (h.permissions && key !== loggedPermissions) {
      loggedPermissions = key;
      const p = probe.snapshot(h.permissions);
      log(`permissions: mic ${p.mic}, systemAudio ${p.systemAudio} (helper: ${h.permissions.systemAudio}), notifications ${p.notifications}`);
    }
    broadcast();
  });
  probe.on("change", broadcast);
  settings.on("change", (value, changed) => {
    log(`settings changed: ${Object.keys(changed).join(", ")}`);
    if (changed.theme !== undefined) applyTheme(value.theme);
    if (changed.callDetection !== undefined) syncDetection();
    if (changed.reminderLeadMinutes !== undefined) calendar.replan();
    if (changed.launchAtLogin !== undefined) loginItem = applyLoginItem(value.launchAtLogin, log);
    if (changed.recordShortcut !== undefined) shortcut.set(value.recordShortcut);
    broadcast();
  });
  let wasRecording = false;
  recording.on("change", (r) => {
    // A restart asked for during the recording waits for it to end.
    const active = r.state !== "idle";
    if (wasRecording && !active) updates?.recordingStopped();
    wasRecording = active;
    broadcast();
  });
  recording.on("crashed", () => {
    calendar.notify("Recording stopped unexpectedly", "Notes are being written from what was captured. Talk is restarting its recorder.");
  });
  recording.on("unsaved", ({ meetingId, appUrl, segments, needsFinish }) => {
    try {
      pending.add(meetingId, appUrl, segments, needsFinish);
    } catch (error) {
      log(`couldn't keep unsaved segments for ${meetingId}: ${errorMessage(error)}`);
    }
    void replayPending();
  });
  online.on("change", (c) => {
    log(`connection: ${c}`);
    if (c === "online") void replayPending();
    broadcast();
  });
  powerMonitor.on("resume", () => online.resumed());
  setInterval(() => online.setOsOnline(net.isOnline()), 15_000).unref();
  calendar.on("change", broadcast);
  helper.on("event", (event) => {
    probe.observe(event);
    window.send("helper", event);
    if (event.event === "call.started") calendar.callStarted(event.bundleId, event.appName);
    if (event.event === "call.ended") calendar.callEnded(event.bundleId);
  });

  const requireApi = () => {
    const api = auth.api;
    if (!api) throw new Error("Sign in to Talk first.");
    return api;
  };
  const withAuth = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (error) {
      auth.handleError(error);
      throw error;
    }
  };

  registerIpc({
    "state:get": () => snapshot(),
    "auth:signIn": (appUrl) => auth.signIn(appUrl),
    "auth:cancelSignIn": () => auth.cancelSignIn(),
    "auth:signInWithToken": (appUrl, token) => auth.signInWithToken(appUrl, token),
    "auth:signOut": () => auth.signOut(),
    "recording:start": (req) => startRecording(req),
    "recording:stop": () => recording.stop(),
    "helper:requestPermission": async (kind) => {
      await helper.requestPermission(kind);
    },
    "permissions:get": async () => {
      if (helper.state.status === "ready") await helper.refreshPermissions().catch((e) => log(`permissions.status failed: ${errorMessage(e)}`));
      return probe.snapshot(helper.state.permissions);
    },
    "permissions:request": async (kind: PermissionKind) => {
      if (kind === "notifications") {
        const shown = await requestNotificationPermission();
        if (shown !== undefined) probe.notificationResult(shown);
      } else {
        await helper.requestPermission(kind);
      }
      return probe.snapshot(helper.state.permissions);
    },
    "permissions:openSettings": async (pane) => {
      await shell.openExternal(settingsPaneUrl(pane, isDevFlavor() ? "com.everyapp.talk.dev" : "com.everyapp.talk"));
    },
    "settings:get": () => settings.value,
    "settings:set": (patch) => {
      settings.set(patch);
      // The login item may need approval or may fail: report what macOS says.
      if (patch.launchAtLogin !== undefined && loginItem.status === "disabled" && settings.value.launchAtLogin) {
        settings.set({ launchAtLogin: false });
      }
      return settings.value;
    },
    "calendar:refresh": () => calendar.refresh(),
    "calendar:connect": async () => {
      const url = calendar.state.connectUrl ?? auth.user?.connectUrl;
      if (url && (url.startsWith("https://") || typedAppUrl(url))) await shell.openExternal(url);
    },
    "api:me": () => withAuth(() => requireApi().me()),
    "api:meetings": () => withAuth(() => requireApi().meetings()),
    "api:meeting": (id) => withAuth(() => requireApi().meeting(id)),
    "api:updateMeeting": (id, patch) => withAuth(() => requireApi().updateMeeting(id, patch)),
    "api:call": (method, path, opts) => withAuth(() => requireApi().call(method, path, opts)),
    "update:install": () => installUpdate(),
    "clipboard:writeText": (text) => {
      if (!isCopyableUrl(text, auth.api?.appUrl)) throw new Error("Refused: only https links or this Talk's own links can be copied.");
      clipboard.writeText(normalizedLink(text));
    },
    "app:openInBrowser": async (meetingId) => {
      const base = auth.api?.appUrl;
      if (!base) return;
      await shell.openExternal(meetingId ? `${base}/meetings/${encodeURIComponent(meetingId)}` : base);
    },
  }, origin);

  // talk://record links (from the web app). Any page can open one: start at once only for an
  // event in our own upcoming list, otherwise ask.
  let handlingUrl = false;
  handleUrl = (raw) => {
    const request = parseTalkUrl(raw, URL_SCHEMES);
    if (!request) return log(`ignored a URL with scheme ${raw.split(":")[0]}`);
    if (auth.state.status !== "signedIn") return window.show();
    if (recording.isActive) {
      return calendar.notify("Talk is already taking notes", `For “${recording.state.title ?? "a meeting"}”. Stop it from the menu bar to start another.`);
    }
    if (handlingUrl) return;
    handlingUrl = true;
    void (async () => {
      try {
        if (!calendar.state.lastRefresh) await calendar.refresh();
        const action = resolveTalkUrl(request, calendar.state.events, RecordingController.nowTitle());
        if (action.kind === "start") return await startRecording({ event: action.event, join: action.join });
        window.show();
        const parent = BrowserWindow.getFocusedWindow();
        const options = {
          type: "question" as const,
          message: `Start taking notes for “${action.title}”?`,
          detail: "Talk will transcribe your microphone and your Mac's sound.",
          buttons: ["Take Notes", "Cancel"],
          defaultId: 0,
          cancelId: 1,
        };
        const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
        if (response !== 0 || recording.isActive) return;
        await recording.start({ title: action.title, startsAt: action.start, calendarEventId: action.eventId });
      } catch (error) {
        notifyError("Talk couldn't start", error);
      } finally {
        handlingUrl = false;
      }
    })();
  };

  // Quit: stop a recording first (the helper posts its last segments), then the helper.
  let quitReady = false;
  app.on("before-quit", (e) => {
    window.quitting = true;
    if (quitReady) return;
    e.preventDefault();
    void (async () => {
      try {
        if (recording.isActive) await recording.stop();
      } catch (error) {
        log(`stop on quit failed: ${errorMessage(error)}`);
      }
      await helper.stop();
      tray.destroy();
      quitReady = true;
      app.quit();
    })();
  });
  app.on("second-instance", (_e, argv) => {
    for (const arg of argv) if (URL_SCHEMES.some((s) => arg.startsWith(`${s}:`))) handleUrl?.(arg);
    window.show();
  });
  app.on("activate", () => window.show());
  // Closing the last window keeps Talk in the tray.
  app.on("window-all-closed", () => {});

  tray.create();
  auth.restore();
  if (auth.state.status !== "signedIn") {
    const dev = devSignIn();
    if (dev) {
      const appUrl = typedAppUrl(dev.appUrl);
      if (appUrl) {
        log(`dev sign-in with a token for ${new URL(appUrl).host}`);
        auth.useEphemeral({ kind: "token", appUrl, token: dev.token });
      }
    }
  }
  helper.start();
  window.show();
  broadcast();
  shortcut.set(settings.value.recordShortcut);
  updates = await createUpdater({
    appUrl: () => auth.api?.appUrl,
    accessToken: () => auth.accessToken(),
    freshAccessToken: () => auth.freshAccessToken(),
    canCheck: () => auth.state.status === "signedIn" && online.state === "online",
    isRecording: () => recording.isActive,
    log,
  });
  if (updates) {
    updates.on("change", broadcast);
    updates.on("ready", ({ version }) => window.send("update", { state: "ready", version }));
    updates.on("offer", ({ version }) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: "Restart to update Talk", body: `Talk ${version} is ready. Click to restart now.` });
      n.on("click", () => void installUpdate());
      n.show();
    });
    updates.start();
    // A check that was skipped (signed out or offline at launch) runs once that changes.
    online.on("change", (c) => c === "online" && void updates?.check(false));
    auth.on("change", (a) => a.status === "signedIn" && void updates?.check(false));
  }
  broadcast();
  for (const url of pendingUrls.splice(0)) handleUrl(url);
}
