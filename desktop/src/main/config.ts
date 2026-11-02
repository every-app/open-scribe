// Where things are, per build flavor. A "dev" flavor is `electron-vite dev` or a local package
// ("Talk Dev", bundle id com.everyapp.talk.dev); a release is "Talk" (com.everyapp.talk).

import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const isDevFlavor = (): boolean => !app.isPackaged || app.getName() === "Talk Dev";

/** The helper: always the bundled Contents/MacOS/talk-helper when packaged (what TCC and the
 * signature cover). Unpackaged: TALK_HELPER_PATH, else the fake helper script. */
export function helperPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "..", "MacOS", "talk-helper");
  return process.env.TALK_HELPER_PATH || join(app.getAppPath(), "scripts", "fake-helper.mjs");
}

/** electron-builder writes app-update.yml only when a feed URL was given at build time
 * (TALK_UPDATE_URL); without it the updater stays off. */
export function updateConfigPath(): string | undefined {
  if (!app.isPackaged || isDevFlavor()) return undefined;
  const path = join(process.resourcesPath, "app-update.yml");
  return existsSync(path) ? path : undefined;
}

/** Dev only: sign in with a pasted token at launch, for `everyapp dev` (stub mode takes any
 * bearer). From TALK_DEV_APP_URL + TALK_DEV_TOKEN, or `dev-signin.json` ({ appUrl, token }) in
 * userData, which `pnpm package:local` writes. Never read in a release build. */
export function devSignIn(): { appUrl: string; token: string } | undefined {
  if (!isDevFlavor()) return undefined;
  const { TALK_DEV_APP_URL: appUrl, TALK_DEV_TOKEN: token } = process.env;
  if (appUrl && token) return { appUrl, token };
  const file = join(app.getPath("userData"), "dev-signin.json");
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { appUrl?: unknown; token?: unknown };
    if (typeof parsed.appUrl === "string" && typeof parsed.token === "string") {
      return { appUrl: parsed.appUrl, token: parsed.token };
    }
  } catch {
    // Ignore a broken file.
  }
  return undefined;
}

export const POLL_INTERVAL_MS = 5 * 60_000;
