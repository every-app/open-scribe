# Talk for Mac (Electron)

The desktop app from [docs/desktop-plan.md](../docs/desktop-plan.md): an Electron shell (tray, window, sign-in, calendar prompts, updates) that runs the Swift `talk-helper` for audio and transcription. Electron 45, electron-vite, React 19, Tailwind 4, TanStack Query, electron-builder. This package stands on its own (`pnpm install` here); it doesn't touch `web/`.

```sh
pnpm install
pnpm dev              # electron-vite dev, with the fake helper unless TALK_HELPER_PATH is set
pnpm test             # vitest: PKCE, discovery, redirect parser, refresh/rotation, Access, supervisor…
pnpm typecheck
pnpm package          # an unsigned (ad hoc) release-flavor .app in dist/release/, to prove it packages
pnpm package:local    # "Talk Dev": build, sign with a stable local identity, install, launch (below)
pnpm dist             # release DMG + zip (universal), signed and notarized from env (below)
```

Shells that set `ELECTRON_RUN_AS_NODE=1` (some Electron-based terminals do) break Electron. The `dev` and `start` scripts and `package:local` unset it; unset it yourself if you run `electron` by hand.

## Architecture

```
renderer (React, sandboxed, CSP) ──window.talk──► preload (contextBridge, typed: src/shared/ipc.ts)
                                                     │ ipcRenderer.invoke / on
main (Node) ─────────────────────────────────────────┘
  auth/      Sign in with Every App (OAuth 2.0 + PKCE, loopback redirect), token paste, safeStorage
  api/       /api/v1 client: bearer, refresh-on-401, Cloudflare Access detection
  helper/    supervisor: spawns talk-helper, protocol v1 over stdio, restarts with backoff
  calendar/  polls /calendar/upcoming, prompts 1 min before, "started" nudge, call prompts, talk://
  recording  creates the meeting, starts/stops the helper, follows its state
  tray, window, updater, ipc (validated), log (~/Library/Logs/<app>/main.log)
```

- The **renderer** gets data only through `window.talk` (`src/shared/ipc.ts`): one typed function per channel, plus `on("state" | "helper")`. Main checks that every call comes from our own page and validates its arguments. Context isolation, the sandbox and `default-src 'none'` CSP are on; navigation, new windows, webviews and device permissions are refused. `src/renderer/src/App.tsx` is a placeholder that proves the bridge; Lane UI builds the real screens (TanStack Router goes in `main.tsx` beside the QueryClient already there).
- **The helper** speaks [helper protocol v1](../docs/desktop-plan.md#helper-protocol-v1), typed in `src/shared/protocol.ts`. The supervisor says `hello` and refuses another protocol number. It restarts a crashed helper with backoff (1 s, doubling, up to 30 s, reset after 60 s up), answers `token.needed` with `token.update` and a freshly refreshed token, re-sends `detect.set` after a restart, and forwards every event to the renderer. On quit it stops a recording first, then closes the helper's stdin and gives it 10 s (SIGTERM), then SIGKILL after 60 s.
  - Where it is: always the bundled `Contents/MacOS/talk-helper` when packaged (the signature and TCC cover that copy). Unpackaged (`pnpm dev`) it's `TALK_HELPER_PATH`, else `scripts/fake-helper.mjs`. A `.js`/`.mjs` path runs with Electron as Node.
  - `scripts/fake-helper.mjs` implements the protocol without audio. It fakes a transcript, and like the real helper it posts segments to `{apiBase}/api/v1/meetings/:id/segments` and calls `/finish` on stop, so a fake recording against `everyapp dev` leaves a real meeting behind. Its `FAKE_HELPER_*` knobs (crash, call detection, token.needed, mic denied, protocol number) are listed at the top of the file.
- **Sign-in** is a port of `mac/Sources/TalkCore`: RFC 9728 discovery on the app, then RFC 8414 on the Gateway (`issuer` must match), dynamic registration once per install (re-registered on `invalid_client` or after 50 days unused), PKCE S256, the system browser, a loopback listener on `127.0.0.1:<ephemeral>/callback` that checks `state` and `iss`, and `resource` on authorize/token/refresh with no `scope`. A rotated refresh token is stored before the new access token is used, and concurrent refreshes share one request. `invalid_grant` means signed out. Sign-out revokes the refresh token. The fallback is the app URL plus a personal access token, checked with `/me` before it's kept. If Cloudflare Access answers instead of the app, the app says "Gateway requires Sign in with Every App" and doesn't sign you out.
- **Reminders**: the app polls `/api/v1/calendar/upcoming` every 5 minutes and on wake. One minute before each event that has other attendees or a call link, it shows a notification with "Join & take notes" (when there's a link) and "Take notes". A meeting that started without notes gets one nudge in its first 5 minutes. The helper's `call.started` brings up "Record this call?". Nothing ever records without a click.
- **`talk://record?event=…&title=…&start=…&join=1`** (`talk-dev://` in dev builds): it starts at once only for an event in the app's own upcoming list. Anything else asks first, and the app never opens a link taken from the URL.

## Where tokens live

The sign-in (`{ kind: "oauth", grant }` or `{ kind: "token", appUrl, token }`) and the cached OAuth client ids are one JSON document. It's encrypted with Electron's **`safeStorage`** and written to `~/Library/Application Support/<app>/signin.bin` (0600, atomically). On macOS, safeStorage keeps its key in the login Keychain as "<app> Safe Storage", so the secret is still protected by the Keychain, and the file is unreadable without it.

Why safeStorage rather than a keychain module (keytar and friends):

- It has no native module: nothing to rebuild per Electron version or architecture, which keeps the universal build simple. keytar is archived and unmaintained.
- One Keychain item for everything, read once at launch, so there's one Keychain access instead of one per secret.
- It behaves like the Swift app's Keychain items: under a Developer ID the item's partition is the Team ID, so a signed update keeps the sign-in. The alpha checklist item "a sign-in survives an app update" holds.
- If encryption isn't available, nothing is written in plaintext: the app refuses to keep the sign-in.

The cost: a build signed without a Team ID (ad hoc, or a self-signed cert like "Scrawl Dev") can't read the Keychain key written by a differently signed build. The app then says "This build can't read the saved sign-in… Sign in again" instead of failing.

## Local builds without a Developer ID

`pnpm package:local` makes **Talk Dev**, a real packaged app (not `electron .`) for clicking through by hand or with a computer-use agent:

- Bundle id `com.everyapp.talk.dev`, product name "Talk Dev", URL scheme `talk-dev://`, its own userData, logs and Keychain item. It never collides with the SwiftUI `~/Applications/Talk.app` (`com.everyapp.talk`) in TCC, Launch Services or the Keychain. Release builds keep `com.everyapp.talk` and `talk://`.
- Helper: **`TALK_HELPER=real`** builds the real one with `mac/scripts/build-helper.sh` (this Mac's arch only, unless `TALK_HELPER_ARCHS` says otherwise) and bundles it. `TALK_HELPER_PATH=<binary>` bundles one you already built (e.g. `../mac/.build/helper/talk-helper`). Neither set: a small wrapper runs the fake helper with Electron as Node. The bundled helper is re-signed with the app's identity, keeping its own entitlements and identifier (`com.everyapp.talk.helper`).
- Signing: `TALK_SIGN_ID`, else the self-signed **"Scrawl Dev"** cert if this Mac has it (`security find-identity -v -p codesigning`), else ad hoc. Hardened runtime and `entitlements.dev.plist`. The helper keeps identifier `com.everyapp.talk.helper`. No notarization.
- It installs to `~/Applications/Talk Dev.app` (quitting a running copy first) and launches it. `TALK_NO_LAUNCH=1` skips the launch.

**No Apple Developer ID is needed to run locally.** A stable self-signed cert keeps the microphone and system-audio grants across rebuilds, because TCC matches the bundle id plus the certificate. Ad hoc signing loses them on every rebuild. **The Keychain sign-in is lost on each rebuild without a Team ID**: re-paste the token, or use the dev sign-in below.

### Signed in against local `everyapp dev`

`everyapp dev` runs the Worker in stub mode, where any bearer is the dev user, so a token sign-in with the local URL is enough:

```sh
# in web/: everyapp dev  (seed it as you like), then here:
TALK_DEV_APP_URL=http://talk.localhost:8787 TALK_DEV_TOKEN=dev pnpm package:local
# the same with the real Swift helper:
TALK_HELPER=real TALK_DEV_APP_URL=http://talk.localhost:8787 TALK_DEV_TOKEN=dev pnpm package:local
# or, unpackaged:
TALK_DEV_APP_URL=http://talk.localhost:8787 TALK_DEV_TOKEN=dev pnpm dev
```

`package:local` writes `~/Library/Application Support/Talk Dev/dev-signin.json`. The app reads that file, or the env vars, at launch and signs in with the token **in memory only** (it never stores it, so rebuilds don't matter). Only dev builds read it: unpackaged, or the "Talk Dev" product. Plain `http://` is accepted only for `localhost`, `*.localhost` and `127.0.0.1`. You can also paste the URL and any token in the sign-in screen ("Use an access token instead").

## Release builds: signing, notarization, updates

`pnpm dist` reads everything from the environment:

| What | Env |
| --- | --- |
| Signing identity | `CSC_NAME` (a Keychain identity, e.g. "Developer ID Application: …") or `CSC_LINK` + `CSC_KEY_PASSWORD` (a .p12). None set: ad hoc. |
| Notarization | `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`, or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`. Only with a signing identity. None set: skipped. |
| Helper | `TALK_HELPER_BINARY`, else `../mac/.build/helper/talk-helper` if it exists. electron-builder re-signs it with the app's identity. |
| Update feed | `TALK_UPDATE_URL` (generic provider). Unset: no `app-update.yml` is written and electron-updater stays off. |

The DMG and zip are universal (arm64 + x64), with the hardened runtime and `build/entitlements.mac.plist` (JIT, unsigned executable memory, `com.apple.security.device.audio-input`). Info.plist carries `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription` (TCC charges the helper's capture to Talk.app), `talk://` and macOS 15 as the minimum. Release fuses turn off RunAsNode, `NODE_OPTIONS` and the inspector flags, and turn on asar integrity and asar-only loading. There's no app icon yet (the default Electron icon is used).

## Files

| Path | What |
| --- | --- |
| `src/shared/` | `protocol.ts` (helper protocol v1), `ipc.ts` (the bridge's types), `api.ts` (API shapes + lenient decoders) |
| `src/main/` | `index.ts` (wiring), `auth/`, `api/`, `helper/`, `calendar/`, `recording.ts`, `tray.ts`, `window.ts`, `updater.ts`, `ipc.ts`, `config.ts`, `log.ts` |
| `src/preload/` | the `window.talk` bridge |
| `src/renderer/` | the placeholder UI |
| `scripts/` | `fake-helper.mjs`, `package-local.mjs`, `make-tray-icons.mjs` (draws `resources/tray/*.png`) |
| `build/` | entitlements |
| `test/` | vitest suites and `fakeServer.ts` (a fake Talk app + Gateway) |
