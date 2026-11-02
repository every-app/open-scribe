// electron-updater, switched off until there's a feed: it runs only in a packaged release build
// whose app-update.yml exists (electron-builder writes it when TALK_UPDATE_URL is set at build).
// A feed on the signed-in app's origin (private, behind the Gateway) gets the API's bearer on every
// check and the download it triggers (updateAuth.ts); signed out, the check is skipped.

import { readFileSync } from "node:fs";
import { updateConfigPath } from "./config";
import { feedUrlFrom, updateRequest } from "./updateAuth";

export interface UpdaterState {
  enabled: boolean;
  status?: string;
}

export interface UpdaterAuth {
  appUrl(): string | undefined;
  /** A valid access token (refreshed when near expiry), or undefined when signed out. */
  accessToken(): Promise<string | undefined>;
  /** A forced refresh, after the feed refused the token. */
  freshAccessToken(): Promise<string | undefined>;
}

export async function startUpdater(log: (...p: unknown[]) => void, onChange: (s: UpdaterState) => void, auth: UpdaterAuth): Promise<UpdaterState> {
  const config = updateConfigPath();
  if (!config) return { enabled: false };
  let feedUrl: string | undefined;
  try {
    feedUrl = feedUrlFrom(readFileSync(config, "utf8"));
  } catch {
    feedUrl = undefined;
  }
  const { autoUpdater } = await import("electron-updater");
  autoUpdater.logger = { info: (m: unknown) => log("updater:", m), warn: (m: unknown) => log("updater warn:", m), error: (m: unknown) => log("updater error:", m), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const set = (status: string) => onChange({ enabled: true, status });
  autoUpdater.on("checking-for-update", () => set("checking"));
  autoUpdater.on("update-available", (i) => set(`downloading ${i.version}`));
  autoUpdater.on("update-not-available", () => set("up to date"));
  autoUpdater.on("update-downloaded", (i) => set(`${i.version} ready; installs on quit`));
  autoUpdater.on("error", (e) => set(`error: ${e.message}`));

  const prepare = async (fresh: boolean): Promise<boolean> => {
    const token = fresh ? await auth.freshAccessToken() : await auth.accessToken();
    const r = updateRequest(feedUrl, auth.appUrl(), token);
    if (r.skip) return false;
    autoUpdater.requestHeaders = r.headers;
    return true;
  };
  const check = async () => {
    try {
      if (!(await prepare(false))) return set("signed out; not checked");
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // A refused token: refresh once and try again.
      if (/\b401\b/.test(String(error)) && (await prepare(true).catch(() => false))) {
        await autoUpdater.checkForUpdates().catch((e: unknown) => log("update check failed:", e));
      } else {
        log("update check failed:", error);
      }
    }
  };
  void check();
  setInterval(() => void check(), 6 * 3600_000);
  return { enabled: true, status: "checking" };
}
