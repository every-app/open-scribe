#!/usr/bin/env node
// `pnpm package:local`: a packaged "Talk Dev" for local testing (a person or a computer-use
// agent clicking through the real app). No Apple Developer ID needed.
//
// 1. Builds the app as "Talk Dev" (com.everyapp.talk.dev, talk-dev://), so it never collides with
//    the SwiftUI ~/Applications/Talk.app (com.everyapp.talk) in TCC, Launch Services or the Keychain.
// 2. Bundles Contents/MacOS/talk-helper: TALK_HELPER_PATH if set (a built talk-helper binary);
//    else, by default, the real one, built first with mac/scripts/build-helper.sh (this Mac's arch
//    only unless TALK_HELPER_ARCHS says otherwise). The fake helper (a wrapper that runs
//    scripts/fake-helper.mjs) only on request: TALK_FAKE_HELPER=1 or TALK_HELPER=fake.
// 3. Signs helper and app with a stable identity: TALK_SIGN_ID, else the self-signed "Scrawl Dev"
//    if this Mac has it, else ad hoc. A stable identity keeps mic/system-audio grants across
//    rebuilds. No notarization.
// 4. Installs to ~/Applications/Talk Dev.app (quitting a running one first) and launches it,
//    unless TALK_NO_LAUNCH=1.
// 5. With TALK_DEV_APP_URL + TALK_DEV_TOKEN set, writes the dev sign-in file so the app starts
//    signed in (e.g. http://talk.localhost:8787 + any token against `everyapp dev` in stub mode).

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // Some shells (Electron-based terminals) set it; it breaks electron tooling.
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, env, ...opts });
const step = (s) => console.log(`\n▸ ${s}`);

const PRODUCT = "Talk Dev";
const HELPER_ID = "com.everyapp.talk.helper";

// 1–2. Build, with the helper.
const builderEnv = { TALK_FLAVOR: "dev" };
let realHelper = false;
const wantFake = env.TALK_FAKE_HELPER === "1" || env.TALK_HELPER === "fake";
if (!env.TALK_HELPER_PATH && !wantFake) {
  if (process.platform !== "darwin") throw new Error("The real helper builds only on macOS; set TALK_FAKE_HELPER=1 for the fake one.");
  step("building talk-helper (mac/scripts/build-helper.sh)");
  const script = resolve(root, "..", "mac", "scripts", "build-helper.sh");
  const archs = env.TALK_HELPER_ARCHS ?? (process.arch === "arm64" ? "arm64" : "x86_64");
  const out = execFileSync(script, [], { cwd: root, env: { ...env, TALK_HELPER_ARCHS: archs }, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  env.TALK_HELPER_PATH = out.trim().split("\n").pop();
}
if (env.TALK_HELPER_PATH) {
  realHelper = true;
  const helper = resolve(env.TALK_HELPER_PATH);
  if (!existsSync(helper)) throw new Error(`TALK_HELPER_PATH not found: ${helper}`);
  if (/\.(c|m)?js$/.test(helper)) throw new Error("TALK_HELPER_PATH must be a binary for a package; leave it unset for the fake helper.");
  builderEnv.TALK_HELPER_BINARY = helper;
  step(`bundling the helper from ${helper}`);
} else {
  const dir = join(root, "dist", "fake-helper");
  mkdirSync(dir, { recursive: true });
  const wrapper = join(dir, "talk-helper");
  // Electron runs the fake helper as Node (the RunAsNode fuse stays on in dev builds).
  writeFileSync(
    wrapper,
    `#!/bin/sh\n# Talk Dev's stand-in recorder: scripts/fake-helper.mjs run by Electron as Node.\nDIR="$(cd "$(dirname "$0")" && pwd)"\nELECTRON_RUN_AS_NODE=1 exec "$DIR/${PRODUCT}" "$DIR/../Resources/fake-helper.mjs"\n`,
  );
  chmodSync(wrapper, 0o755);
  builderEnv.TALK_HELPER_BINARY = wrapper;
  builderEnv.TALK_FAKE_HELPER = "1";
  step("bundling the fake helper (TALK_FAKE_HELPER=1 / TALK_HELPER=fake)");
}

step("electron-vite build");
run("pnpm", ["exec", "electron-vite", "build"]);
step("electron-builder (dir, unsigned)");
rmSync(join(root, "dist", "dev"), { recursive: true, force: true });
run("pnpm", ["exec", "electron-builder", "--config", "electron-builder.config.cjs", "--mac", "--dir"], {
  env: { ...env, ...builderEnv, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});

const outDir = join(root, "dist", "dev");
const built = readdirSync(outDir)
  .filter((d) => d.startsWith("mac"))
  .map((d) => join(outDir, d, `${PRODUCT}.app`))
  .find(existsSync);
if (!built) throw new Error(`No ${PRODUCT}.app under ${outDir}`);

// 3. Sign, inside out.
function identity() {
  if (env.TALK_SIGN_ID) return env.TALK_SIGN_ID;
  const list = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" }).stdout ?? "";
  return list.includes('"Scrawl Dev"') ? "Scrawl Dev" : "-";
}
const id = identity();
step(`signing with ${id === "-" ? "an ad hoc signature (grants reset every rebuild)" : `"${id}"`}`);
const entitlements = join(root, "build", "entitlements.dev.plist");
const sign = (path, extra = []) =>
  run("codesign", ["--force", "--options", "runtime", "--timestamp=none", "--entitlements", entitlements, ...extra, "--sign", id, path], {
    stdio: ["ignore", "ignore", "inherit"],
  });
const frameworks = join(built, "Contents", "Frameworks");
for (const item of readdirSync(frameworks)) sign(join(frameworks, item), ["--deep"]);
const helperPath = join(built, "Contents", "MacOS", "talk-helper");
// The real helper keeps its own entitlements (audio-input) and embedded Info.plist; only the
// signature is redone, so it matches the app's.
if (existsSync(helperPath)) {
  if (realHelper) {
    run("codesign", ["--force", "--options", "runtime", "--timestamp=none", "--preserve-metadata=entitlements,identifier,flags", "--sign", id, helperPath], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } else {
    sign(helperPath, ["--identifier", HELPER_ID]);
  }
}
sign(built);
run("codesign", ["--verify", "--deep", "--strict", built]);

// 4. Install and launch.
const apps = join(homedir(), "Applications");
const target = join(apps, `${PRODUCT}.app`);
step(`installing ${target}`);
// Only when it's running: `tell application … to quit` launches an app that isn't.
if (spawnSync("pgrep", ["-x", PRODUCT]).status === 0) {
  spawnSync("osascript", ["-e", `if application id "com.everyapp.talk.dev" is running then tell application id "com.everyapp.talk.dev" to quit`], { stdio: "ignore" });
}
for (let i = 0; i < 50 && spawnSync("pgrep", ["-x", PRODUCT]).status === 0; i++) spawnSync("sleep", ["0.2"]);
spawnSync("pkill", ["-x", PRODUCT]);
mkdirSync(apps, { recursive: true });
rmSync(target, { recursive: true, force: true });
run("ditto", [built, target]);

// 5. Dev sign-in.
if (env.TALK_DEV_APP_URL && env.TALK_DEV_TOKEN) {
  const userData = join(homedir(), "Library", "Application Support", PRODUCT);
  mkdirSync(userData, { recursive: true });
  const file = join(userData, "dev-signin.json");
  writeFileSync(file, JSON.stringify({ appUrl: env.TALK_DEV_APP_URL, token: env.TALK_DEV_TOKEN }), { mode: 0o600 });
  step(`wrote the dev sign-in for ${env.TALK_DEV_APP_URL} (${file})`);
}

if (env.TALK_NO_LAUNCH === "1") {
  console.log(`\nInstalled ${target} (not launched).`);
} else {
  // `open` hands its environment to the app; keep build-time variables out of it.
  const launchEnv = { ...env };
  for (const k of ["TALK_HELPER_PATH", "TALK_HELPER", "TALK_FAKE_HELPER", "TALK_HELPER_ARCHS", "TALK_DEV_TOKEN", "TALK_DEV_APP_URL"]) delete launchEnv[k];
  run("open", [target], { env: launchEnv });
  console.log(`\nLaunched ${target}.`);
}
