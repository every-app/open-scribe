// Talk's main process: sign-in and tokens, the tray, the window, calendar prompts, the updater,
// and the helper supervisor. The renderer reaches it only through the typed preload bridge.

import { app, BrowserWindow, dialog, session, shell, safeStorage } from "electron";
import { join } from "node:path";
import type { AppSnapshot, StartRecordingRequest } from "@shared/ipc";
import type { CalendarEvent } from "@shared/api";
import { AuthService } from "./auth/service";
import { SecretStore } from "./auth/store";
import { errorMessage } from "./auth/oauth";
import { CalendarService } from "./calendar/service";
import { parseTalkUrl, resolveTalkUrl } from "./calendar/talkUrl";
import { devSignIn, helperPath, isDevFlavor } from "./config";
import { HelperSupervisor } from "./helper/supervisor";
import { registerIpc } from "./ipc";
import { log } from "./log";
import { RecordingController } from "./recording";
import { TrayController, trayStateFor } from "./tray";
import { startUpdater, type UpdaterState } from "./updater";
import { MainWindow } from "./window";
import { typedAppUrl } from "./auth/url";

// `electron-vite dev` runs as "Talk Dev" too: its own userData and its own "Talk Dev Safe Storage"
// Keychain item, apart from any installed Talk.
if (!app.isPackaged) {
  app.setName("Talk Dev");
  app.setPath("userData", join(app.getPath("appData"), "Talk Dev"));
}

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
  app.on("web-contents-created", (_e, contents) => {
    // Nothing navigates in-app or attaches a webview.
    contents.on("will-navigate", (e, url) => {
      const dev = process.env.ELECTRON_RENDERER_URL;
      if (!(dev && !app.isPackaged && url.startsWith(dev))) e.preventDefault();
    });
    contents.on("will-attach-webview", (e) => e.preventDefault());
  });
  void app.whenReady().then(main);
}

async function main(): Promise<void> {
  log(`Talk ${app.getVersion()} (${app.getName()}) starting; packaged ${app.isPackaged}`);
  // The renderer needs no device or other permission; the helper does the capturing.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const store = new SecretStore(join(app.getPath("userData"), "signin.bin"), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  });
  const auth = new AuthService({
    store,
    openBrowser: (url) => shell.openExternal(url),
    log,
  });

  const helper = new HelperSupervisor({
    path: helperPath(),
    freshToken: () => auth.freshAccessToken(),
    log,
  });
  const recording = new RecordingController(auth, helper, log);
  const window = new MainWindow(join(__dirname, "../preload/index.js"));

  let updater: UpdaterState = { enabled: false };

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
    },
    log,
  );

  const tray = new TrayController({
    open: () => window.show(),
    start: () => void startRecording({}).catch((e) => notifyError("Talk couldn't start", e)),
    stop: () => void recording.stop().catch((e) => notifyError("Talk couldn't stop", e)),
    quit: () => app.quit(),
  });

  const snapshot = (): AppSnapshot => {
    const s = {
      version: app.getVersion(),
      auth: auth.state,
      helper: helper.state,
      recording: recording.state,
      calendar: calendar.state,
      updater,
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
      window.send("state", s);
    });
  };

  let wasSignedIn = false;
  auth.on("change", (a) => {
    const signedIn = a.status === "signedIn";
    if (signedIn && !wasSignedIn) {
      void auth.loadMe();
      calendar.start();
      void helper.setDetection(true).catch(() => {});
    } else if (!signedIn && wasSignedIn) {
      calendar.stop();
      void helper.setDetection(false).catch(() => {});
      if (recording.isActive) void recording.stop().catch(() => {});
    }
    wasSignedIn = signedIn;
    broadcast();
  });
  helper.on("status", broadcast);
  recording.on("change", broadcast);
  calendar.on("change", broadcast);
  helper.on("event", (event) => {
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
    "calendar:refresh": () => calendar.refresh(),
    "calendar:connect": async () => {
      const url = calendar.state.connectUrl ?? auth.user?.connectUrl;
      if (url && (url.startsWith("https://") || typedAppUrl(url))) await shell.openExternal(url);
    },
    "api:me": () => withAuth(() => requireApi().me()),
    "api:meetings": () => withAuth(() => requireApi().meetings()),
    "api:meeting": (id) => withAuth(() => requireApi().meeting(id)),
    "api:updateMeeting": (id, patch) => withAuth(() => requireApi().updateMeeting(id, patch)),
    "app:openInBrowser": async (meetingId) => {
      const base = auth.api?.appUrl;
      if (!base) return;
      await shell.openExternal(meetingId ? `${base}/meetings/${encodeURIComponent(meetingId)}` : base);
    },
  });

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
  updater = await startUpdater(log, (u) => {
    updater = u;
    broadcast();
  });
  broadcast();
  for (const url of pendingUrls.splice(0)) handleUrl(url);
}
