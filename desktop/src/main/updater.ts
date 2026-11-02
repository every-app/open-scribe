// electron-updater, switched off until there's a feed: it runs only in a packaged release build
// whose app-update.yml exists (electron-builder writes it when TALK_UPDATE_URL is set at build).

import { updateConfigPath } from "./config";

export interface UpdaterState {
  enabled: boolean;
  status?: string;
}

export async function startUpdater(log: (...p: unknown[]) => void, onChange: (s: UpdaterState) => void): Promise<UpdaterState> {
  const config = updateConfigPath();
  if (!config) return { enabled: false };
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
  const check = () => autoUpdater.checkForUpdates().catch((e: unknown) => log("update check failed:", e));
  void check();
  setInterval(check, 6 * 3600_000);
  return { enabled: true, status: "checking" };
}
