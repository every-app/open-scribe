// End-to-end smoke of the real app: main, preload and renderer as built (`pnpm build`), the fake
// helper for audio, and an in-memory mock of /api/v1. It runs with its own temporary
// --user-data-dir, so it never takes the installed Talk Dev's single-instance lock or touches its
// settings, sign-in or logs. On failure it keeps a screenshot and a Playwright trace
// (test-results/e2e, uploaded by CI).

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

// Playwright loads this spec as CommonJS (desktop/ isn't "type": "module").
const root = resolve(__dirname, "..");

/** The mock /api/v1 (e2e/mock-api.mjs) in its own Node process, driven over HTTP. */
class Mock {
  private constructor(
    readonly url: string,
    private readonly child: ChildProcess,
  ) {}

  static start(): Promise<Mock> {
    const child = spawn(process.execPath, [join(__dirname, "mock-api.mjs")], { env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
    return new Promise((done, fail) => {
      child.once("exit", (code) => fail(new Error(`the mock API exited (${code})`)));
      child.stdout!.on("data", (chunk: Buffer) => {
        const url = /on (http:\/\/127\.0\.0\.1:\d+)/.exec(chunk.toString())?.[1];
        if (url) done(new Mock(url, child));
      });
    });
  }

  async setMode(mode: "online" | "offline" | "unauthorized"): Promise<void> {
    const res = await fetch(`${this.url}/__mock/mode`, { method: "POST", body: JSON.stringify({ mode }) });
    if (!res.ok) throw new Error(`mode ${mode}: HTTP ${res.status}`);
  }

  async requests(): Promise<string[]> {
    return ((await (await fetch(`${this.url}/__mock/requests`)).json()) as { requests: string[] }).requests;
  }

  close(): void {
    this.child.kill();
  }
}

let mock: Mock;

/** Main's view of the recording (the window's own state:get), e.g. "recording", "stopping", "idle". */
async function recordingState(): Promise<string> {
  return page.evaluate(async () => {
    const talk = (window as unknown as { talk: { "state:get"(): Promise<{ recording: { state: string } }> } }).talk;
    return (await talk["state:get"]()).recording.state;
  });
}
let app: ElectronApplication;
let page: Page;
let userData: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mock = await Mock.start();
  userData = realpathSync(mkdtempSync(join(tmpdir(), "talk-e2e-")));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    TALK_DEV_APP_URL: mock.url,
    TALK_DEV_TOKEN: "e2e-token",
    FAKE_HELPER_LINE_MS: "600",
    // A fake updater that finds and "downloads" this version at launch (dev builds only).
    TALK_E2E_FAKE_UPDATE: "9.9.9",
    // No real recorder, ever: the unpackaged app runs scripts/fake-helper.mjs unless this is set.
    TALK_HELPER_PATH: "",
  });
  const args = [root, `--user-data-dir=${userData}`];
  // GitHub's Linux runners can't use Chromium's setuid sandbox.
  if (process.platform === "linux") args.push("--no-sandbox");
  app = await electron.launch({ executablePath: require("electron") as unknown as string, args, env, cwd: root });
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  page = await app.firstWindow();
  // Never steal focus for long: the window shows (rendering needs it) but stays where it is.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && page && !page.isClosed()) {
    await page.screenshot({ path: testInfo.outputPath("failure.png") }).catch(() => {});
    await app.context().tracing.stop({ path: testInfo.outputPath("trace.zip") }).catch(() => {});
    await app.context().tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
  }
});

test.afterAll(async () => {
  await app?.context().tracing.stop().catch(() => {});
  await app?.close().catch(() => {});
  mock?.close();
  if (userData) rmSync(userData, { recursive: true, force: true });
});

test("launches signed in through the dev env, shows first-run, then Home", async () => {
  // First run asks for permissions (Continue waits for the mic, which CI can't grant): it shows,
  // then it's skipped the way a finished onboarding is remembered.
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("talk.onboarded", "1"));
  await page.reload();
  await expect(page.getByText("Coming up")).toBeVisible();
  await expect(page.getByRole("button", { name: /Northwind pricing follow-up/ })).toBeVisible();
  // The profile is the temp one: main wrote its files there.
  const where = await app.evaluate(({ app: a }) => a.getPath("userData"));
  expect(where).toBe(userData);
});

test("opens a meeting and switches its tabs", async () => {
  await page.getByRole("button", { name: /Northwind pricing follow-up/ }).click();
  for (const name of ["Transcript", "Your jottings", "Notes"]) {
    const tab = page.getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }
});

test("⌘N records with the fake helper: jottings, live transcript, Stop", async () => {
  await page.evaluate(() => (location.hash = "#/"));
  await expect(page.getByText("Coming up")).toBeVisible();
  await page.keyboard.press("Meta+n");
  await page.waitForURL(/#\/meetings\//);
  const notepad = page.getByRole("textbox", { name: "Your notes" });
  await notepad.click();
  await page.keyboard.type("- e2e jotting one\nsecond point");
  await page.getByRole("button", { name: /Transcript/ }).click();
  const drawer = page.getByRole("complementary", { name: "Live transcript" });
  await expect(drawer.getByText("Thanks everyone for joining.")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200); // the notepad autosaves after an 800 ms pause
  await page.getByRole("button", { name: /^Stop$/ }).click();
  // Stop turns into "Finishing…" as soon as the stop begins (#40), so that alone doesn't mean the
  // helper is done: wait for main to say the recording is over, then for the requests it made.
  await expect.poll(recordingState, { timeout: 20_000 }).toBe("idle");
  await expect
    .poll(async () => (await mock.requests()).some((r) => /^POST \/api\/v1\/meetings\/[^/]+\/segments$/.test(r)), { timeout: 10_000 })
    .toBe(true);
  await expect
    .poll(async () => (await mock.requests()).some((r) => /^POST \/api\/v1\/meetings\/[^/]+\/finish$/.test(r)), { timeout: 10_000 })
    .toBe(true);
});

test("the jottings are still there after reopening the meeting", async () => {
  const meetingHash = await page.evaluate(() => location.hash);
  await page.evaluate(() => (location.hash = "#/"));
  await expect(page.getByText("Coming up")).toBeVisible();
  await page.evaluate((h) => (location.hash = h), meetingHash);
  await page.getByRole("tab", { name: "Your jottings" }).click();
  const jottings = page.getByRole("textbox", { name: "Your jottings" });
  await expect(jottings).toHaveValue(/e2e jotting one[\s\S]*second point/);
  // And the server has them (not just the window's cache).
  const id = decodeURIComponent(meetingHash.split("/").pop() ?? "");
  const stored = (await (await fetch(`${mock.url}/api/v1/meetings/${encodeURIComponent(id)}`, { headers: { authorization: "Bearer e2e" } })).json()) as {
    meeting: { jottings: { markdown: string } | null };
  };
  expect(stored.meeting.jottings?.markdown).toMatch(/e2e jotting one[\s\S]*second point/);
});

test("a Settings switch persists across a reload", async () => {
  await page.evaluate(() => (location.hash = "#/settings"));
  const calls = page.getByRole("switch", { name: "Ask to record calls" });
  await expect(calls).toBeVisible();
  const before = await calls.getAttribute("aria-checked");
  await calls.click();
  const after = before === "true" ? "false" : "true";
  await expect(calls).toHaveAttribute("aria-checked", after);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Ask to record calls" })).toHaveAttribute("aria-checked", after);
  // Main is the one that kept it, in the temp profile.
  expect(JSON.parse(readFileSync(join(userData, "settings.json"), "utf8")).callDetection).toBe(after === "true");
});

test("shows the offline banner when the app can't be reached, and clears it after", async () => {
  await mock.setMode("offline");
  await page.evaluate(() => (location.hash = "#/"));
  await page.reload(); // any /api/v1 call notices
  const banner = page.getByText("Offline. Recording continues, and notes sync when you're back.");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await mock.setMode("online");
  await expect(banner).toBeHidden({ timeout: 20_000 });
});

test("shows the sign-in-again prompt, in place, when the token is refused", async () => {
  await page.evaluate(() => (location.hash = "#/settings"));
  await expect(page.getByRole("switch", { name: "Ask to record calls" })).toBeVisible();
  await mock.setMode("unauthorized");
  await page.evaluate(() => (location.hash = "#/"));
  // A token sign-in asks for a new token (an OAuth one shows "Sign in again"); the page stays.
  await expect(page.getByLabel("New access token")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Coming up")).toBeVisible();
  // Signing in again with a working token clears it.
  await mock.setMode("online");
  await page.getByLabel("New access token").fill("e2e-token-2");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page.getByLabel("New access token")).toBeHidden({ timeout: 15_000 });
});

test("an update that downloaded is offered, and waits for the recording to end", async () => {
  type Snap = { updater: { state: string; version?: string; deferred?: boolean }; recording: { state: string } };
  const snap = () => page.evaluate(() => (window as unknown as { talk: { "state:get"(): Promise<unknown> } }).talk["state:get"]()) as Promise<Snap>;
  await expect.poll(async () => (await snap()).updater).toMatchObject({ state: "ready", version: "9.9.9" });
  // The window's quiet pill in the sidebar footer (#43).
  const pill = page.getByRole("status", { name: "Update" });
  await expect(pill).toContainText("Update ready · 9.9.9");
  await expect(pill.getByRole("button", { name: "Restart" })).toBeVisible();
  const menuLabels = () =>
    app.evaluate(({ Menu }) => {
      const out: string[] = [];
      const walk = (items: Electron.MenuItem[]) => items.forEach((i) => (out.push(i.label), i.submenu && walk(i.submenu.items)));
      walk(Menu.getApplicationMenu()?.items ?? []);
      return out;
    });
  expect(await menuLabels()).toContain("Restart to Update (9.9.9)");
  expect(await menuLabels()).toContain("Check for Updates…"); // always in the menu, feed or not
  // During a recording, asking to restart defers it; Stop offers it again.
  await page.evaluate(() => (location.hash = "#/"));
  await page.keyboard.press("Meta+n");
  await page.waitForURL(/#\/meetings\//);
  await expect.poll(async () => (await snap()).recording.state).toBe("recording");
  await expect(pill).toBeHidden(); // never while recording
  expect(await menuLabels()).toContain("Restart to Update (9.9.9) after this recording");
  const result = await page.evaluate(() => (window as unknown as { talk: { "update:install"(): Promise<{ deferred: boolean }> } }).talk["update:install"]());
  expect(result).toEqual({ deferred: true });
  expect((await snap()).updater.deferred).toBe(true);
  await page.getByRole("button", { name: /^Stop$/ }).click();
  await expect.poll(async () => (await snap()).updater.deferred).toBe(false);
  expect(await menuLabels()).toContain("Restart to Update (9.9.9)");
  // After Stop, the pill offers the restart that was put off.
  await expect(pill).toContainText("Restart to update", { timeout: 15_000 });
});

test("Help → Reset Onboarding (dev builds) shows first run again", async () => {
  const clicked = await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const i of items) {
        if (i.label === "Reset Onboarding") return i;
        const inner = i.submenu && find(i.submenu.items);
        if (inner) return inner;
      }
      return undefined;
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    item?.click();
    return !!item;
  });
  expect(clicked).toBe(true);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({ timeout: 15_000 });
  // Only the flag went: still signed in, settings kept.
  expect(JSON.parse(readFileSync(join(userData, "settings.json"), "utf8"))).toBeTruthy();
  await page.evaluate(() => {
    localStorage.setItem("talk.onboarded", "1");
    location.hash = "#/";
  });
  await page.reload();
  await expect(page.getByText("Coming up")).toBeVisible();
});
