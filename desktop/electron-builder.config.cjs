// electron-builder config. Everything that differs per machine comes from the environment:
//
//   TALK_FLAVOR=dev            "Talk Dev" (com.everyapp.talk.dev, talk-dev://), never signed here:
//                              scripts/package-local.mjs signs it with a stable local identity.
//   TALK_HELPER_BINARY=path    the talk-helper to put at Contents/MacOS/talk-helper
//                              (else mac/.build/helper/talk-helper if it exists, else none).
//   TALK_UPDATE_URL=url        the update feed (generic provider). Unset: no app-update.yml, so the
//                              updater stays off.
//   Signing (release):         CSC_NAME (a Keychain identity) or CSC_LINK + CSC_KEY_PASSWORD.
//                              None set: ad hoc.
//   Notarizing (release):      APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID +
//                              APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID. None set: skipped.

const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const env = process.env;
const dev = env.TALK_FLAVOR === "dev";
const productName = dev ? "Talk Dev" : "Talk";
const appId = dev ? "com.everyapp.talk.dev" : "com.everyapp.talk";
const scheme = dev ? "talk-dev" : "talk";

const defaultHelper = resolve(__dirname, "..", "mac", ".build", "helper", "talk-helper");
const helper = env.TALK_HELPER_BINARY || (existsSync(defaultHelper) ? defaultHelper : undefined);
if (helper && !existsSync(helper)) throw new Error(`TALK_HELPER_BINARY not found: ${helper}`);
if (!helper) console.warn("electron-builder: no talk-helper to bundle; the app will say the recorder isn't installed.");
// A release ships the real universal helper (scripts/release-helper.mjs builds it). Refuse anything else.
if (!dev && process.platform === "darwin") {
  if (!helper) throw new Error("A release build needs the real talk-helper: run it through `pnpm package` / `pnpm dist`.");
  const archs = require("node:child_process").execFileSync("lipo", ["-archs", helper], { encoding: "utf8" }).trim().split(/\s+/);
  if (!archs.includes("arm64") || !archs.includes("x86_64")) {
    throw new Error(`The release talk-helper must be universal (arm64 + x86_64); ${helper} has ${archs.join(", ")}.`);
  }
}

const hasSigningIdentity = !!(env.CSC_NAME || env.CSC_LINK);
const canNotarize = !!(
  (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) ||
  (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
);

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId,
  productName,
  directories: { output: dev ? "dist/dev" : "dist/release", buildResources: "build" },
  files: ["out/**", "resources/**", "package.json"],
  extraMetadata: { productName },
  asar: true,
  extraFiles: helper ? [{ from: helper, to: "MacOS/talk-helper" }] : [],
  // The fake helper (a script) needs its source beside the wrapper; harmless otherwise.
  extraResources: dev && env.TALK_FAKE_HELPER === "1" ? [{ from: "scripts/fake-helper.mjs", to: "fake-helper.mjs" }] : [],
  protocols: [{ name: productName, schemes: [scheme] }],
  publish: env.TALK_UPDATE_URL && !dev ? [{ provider: "generic", url: env.TALK_UPDATE_URL }] : null,
  // Release: no running as Node, no inspector flags, only the signed asar. Dev keeps RunAsNode,
  // which the fake helper's wrapper uses.
  electronFuses: dev
    ? undefined
    : {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
      },
  mac: {
    category: "public.app-category.productivity",
    icon: join("build", "icon.icns"),
    minimumSystemVersion: "15.0",
    target: dev
      ? [{ target: "dir" }]
      : [
          { target: "dmg", arch: ["universal"] },
          // electron-updater on macOS installs from the zip.
          { target: "zip", arch: ["universal"] },
        ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    // Without a Team ID (ad hoc), library validation would refuse Electron's own frameworks.
    entitlements: join("build", hasSigningIdentity ? "entitlements.mac.plist" : "entitlements.dev.plist"),
    entitlementsInherit: join("build", hasSigningIdentity ? "entitlements.mac.inherit.plist" : "entitlements.dev.plist"),
    // Dev: unsigned here (package-local signs). Release without an identity: ad hoc.
    identity: dev ? null : hasSigningIdentity ? undefined : "-",
    notarize: !dev && hasSigningIdentity && canNotarize,
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Talk transcribes your side of a meeting while you record it. Audio is never saved.",
      NSAudioCaptureUsageDescription:
        "Talk transcribes the other side of a meeting from your Mac's sound while you record it. Audio is never saved.",
      LSApplicationCategoryType: "public.app-category.productivity",
    },
  },
  dmg: { title: productName },
};
