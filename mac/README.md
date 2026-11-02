# Talk for Mac

The menu-bar recorder (docs/SPEC.md). SwiftUI `MenuBarExtra`, `LSUIElement`, macOS 15+, SwiftPM only (no Xcode project). Also `talk-helper`, the headless capture and transcription process the Electron desktop app spawns (docs/desktop-plan.md); see [talk-helper](#talk-helper) below.

```sh
./scripts/build-app.sh      # build, sign, install ~/Applications/Talk.app, restart it
./scripts/test.sh           # unit tests (Swift Testing; works with only the Command Line Tools)
swift run talk-smoke http://talk.localhost:8787 any-token   # API client against a running web/
```

Headless sign-in, for agents and the end-to-end lane (no browser click from the app):

```sh
swift run talk-smoke signin https://talk.<base>   # prints AUTHORIZE_URL …; open it, approve; waits on the loopback
swift run talk-smoke status                           # host, method, expiry (never a token)
swift run talk-smoke https://talk.<base> --keychain   # API smoke with the stored sign-in + one forced refresh
swift run talk-smoke token --out F [--refresh-out G]   # tokens to new 0600 files, for negative checks (prints no token)
swift run talk-smoke refresh                          # one forced refresh (rotated refresh token saved at once)
swift run talk-smoke app-state                        # asks the RUNNING app what its menu shows (host, email, calendar, menu lines)
swift run talk-smoke signout [--keep-copy <file>]     # revoke the refresh token, clear the sign-in
                                                         # --keep-copy: first write the access token to a new 0600 file (to check it then gets 401)
```

These run the app's real `SignInFlow`. The Keychain commands are handed to the installed app binary (`Talk --cli …`, from `scripts/build-app.sh`) so the tokens belong to the app's signed identity: the app reads them without a Keychain prompt, and a running app reloads them at once (a distributed notification). `TALK_SIGNIN_TIMEOUT` (seconds, default 600) bounds the wait; `TALK_APP_BINARY` points at another build.

The app logs sign-in and calendar changes (hosts and counts, never tokens): `log show --last 10m --predicate 'subsystem == "com.everyapp.talk"'`.

`TALK_NO_LAUNCH=1` builds and installs without restarting. `TALK_CONFIG=release` builds optimized. `TALK_DIAG=1` (when you run the binary directly) prints the app's windows, the status item's among them.

## Layout

| Path | What |
| --- | --- |
| `Sources/TalkCore` | No hardware, no UI, all tested: PKCE, the loopback redirect parser, the OAuth client, `AuthProvider`, `SignInFlow`, the API client and its lenient decoders, `SegmentBatcher`, `ChunkCutter`, `Resampler` (windowed sinc) and PCM16, `TurnDetector`, `ReminderPlanner` and `StartedNudge`, `TalkURL`, WAV, the Keychain store |
| `Sources/TalkRecording` | Recording without UI or Keychain, shared by the app and the helper: `MicCapture` (AVAudioEngine), `SystemAudioCapture` (Core Audio process tap), `RealtimeSession`/`TranscriptionChannel`, `ChunkChannel` (fallback), `RecordingPipeline` (channels, capture, 10 s posting, `/finish`, levels), `CallDetection`, `AudioDevices`, and the helper protocol (`Helper/`: codec, `HelperAuth`, `HelperServer`) |
| `Sources/talk-helper` | The helper's `main`: stdin/stdout, signals, device-change watcher |
| `Sources/Talk` | The app: menu, Settings (sign-in, permissions), `OAuthSignIn` (the loopback listener), `Recorder` (creates the meeting, runs `RecordingPipeline`), `Reminders`, the talk:// handler (`AppDelegate`, `AppModel.handle`) |
| `Tests/TalkRecordingTests` | The protocol codec, the dispatcher driven with fake capture, channels and Worker (401 → `token.needed` → retry, fallback, shutdown), the call detector with a fake process source |
| `Resources` | Info.plist and entitlements, copied by the build script |

## Sign-in

`AuthProvider` hands the API client a bearer token, whatever kind of sign-in made it:

- **Access token** (works today): the app URL plus a personal access token, kept in the Keychain. Behind Cloudflare Access a bearer alone gets Access's login; the API client spots that (a redirect to, or a page from, `*.cloudflareaccess.com`, even on a 401/403) and says "Gateway requires Sign in with Every App" instead of signing out.
- **Every App** (the design's §12/§13; needs the Gateway's `feature/native-sign-in`): the person types the Talk app URL, the same field the token uses. `GET {app}/.well-known/oauth-protected-resource` (RFC 9728) must name the app's origin as `resource` and gives the Gateway (`authorization_servers[0]`); the Gateway's `/.well-known/oauth-authorization-server` must name the same `issuer`. The client registers once per install (redirect `http://127.0.0.1/callback`, any port), its id cached in the Keychain per issuer with when it was last used; it re-registers on `invalid_client`, or before the browser opens once the id has gone 50 days unused (the Gateway drops it at 60, and its authorize page can't redirect an unknown client back to us). PKCE S256, the system browser, a loopback listener on an ephemeral port that checks `state` and `iss`, then the token exchange. `resource={origin}` on authorize, token and refresh; no `scope` anywhere. Rotated refresh tokens are stored before the new access token is used; `invalid_grant` means sign in again; sign-out revokes the refresh token. The logic is `SignInFlow` in Core (tested); the app adds the browser and the listener.

## Menu

The web app is the main window; the menu bar is for taking notes. Signed in, it shows **Take Notes Now** (⌘R), or while recording the live line and **Stop Recording** (⌘.); **Open Last Meeting's Notes** after one; the next 24 hours of meetings, each a submenu with **Join & Take Notes** and **Join Call** (when it has a call link) and **Take Notes**; **Open Talk** (⌘O, the web app); the signed-in host; **Settings…** and **Quit Talk**. `talk-smoke app-state` prints the same lines (`menu.N`).

## Meeting prompts

Only events that look like meetings (other attendees or a call link) get them.

- **A minute before**: a notification with the event's title and "Starts at 2:00 PM. Join and take notes?" (the time, not "in N minutes": it's written when scheduled). Actions: **Join & Take Notes** (only with a call link: opens it and starts recording that event) and **Take Notes**. Clicking the notification does the first one. These are scheduled on every calendar poll with a wall-clock trigger, so a Mac that slept still fires on time; one whose minute has passed fires at once, once.
- **Once it has started**: if it began in the last five minutes and Talk isn't recording anything, "<title> started. Take notes?" with the same actions, once per event and start time. This depends on the recorder, so it isn't scheduled: the app checks every 30 s, after each poll, and after wake.
- When recording starts for an event its prompts are removed, and polls don't schedule one for it.

## talk:// URLs

The web app's Record and New note buttons open `talk://record`, which the app takes from the Apple Event (`kAEGetURL`, set up in `applicationWillFinishLaunching`).

| URL | Does |
| --- | --- |
| `talk://record` | Take notes now ("Meeting at 2:00 PM"), after asking |
| `talk://record?event=<calendarEventId>&title=<t>&start=<ISO 8601>` | Take notes for that event |
| `…&join=1` | Also open the event's call link |

Any web page can open these, so the mic starts at once only when `event` is one of the app's own upcoming events, and then the app's title, start and call link are used, not the URL's. Anything else (no event, or one the app doesn't know) asks first: "Start taking notes for "<title>"?" with Take Notes / Cancel, and never opens a link from the URL. Not signed in opens Settings; already recording only posts "Talk is already taking notes". The parsing and that decision are `TalkURL` in Core (tested). Try it with `open 'talk://record?title=Test'`.

## Recording

`POST /api/v1/meetings` carries the title, start, and for a calendar event its id and attendees (`[{ email, name, self }]`). Mic and system audio are converted to PCM16 24 kHz mono on the Mac and streamed to two OpenAI Realtime transcription sockets (`me`, `them`), each with its own ephemeral key from `POST /api/v1/meetings/:id/transcription-token`. Turns are detected on the Mac (600 ms of silence or 30 s, Scrawl's rule). Finished segments are posted every 10 s and on stop, and the meeting is finished on stop. If the token route reports live keys unavailable (`ai_route_not_allowed`, or a 403/501/502/503 other than `ai_provider_not_configured`), both speakers switch to the fallback: chunks of up to 30 s, cut at a turn's end once 20 s have gathered (and silence dropped), are posted to `POST …/audio-chunk` as in-memory WAVs. Audio is never written to disk.

## Signing and permissions (Scrawl's lessons)

TCC ties microphone, system audio and notification grants to the bundle's path and code identity, so:

- The app always runs from `~/Applications/Talk.app`, never from `.build/`.
- It is signed with a stable certificate (`TALK_SIGN_ID`, else a self-signed "Talk Dev" code-signing cert, else "Scrawl Dev" if present), with the hardened runtime and `com.apple.security.device.audio-input`. Ad-hoc signing works but makes macOS ask again after every rebuild.
- **The Keychain is stricter than TCC.** A login-keychain item is bound to its creator's partition: `teamid:<TEAM>` under a Developer ID, but the binary's cdhash under a signature without a Team ID (any self-signed cert, "Scrawl Dev" included). So every dev rebuild loses the saved sign-in: the new build can't read it (`talk-smoke status` and Settings say so) and you sign in again. Releases must be signed with a Developer ID so updates keep the sign-in. `TALK_KEYCHAIN_SERVICE` moves the app's items to another service name for experiments.
- Permissions are asked from Settings or right before a recording starts, never from inside capture code. System audio has no ask/check API: macOS prompts the first time a process tap starts (Settings → "Allow…" starts a one-second tap to bring the prompt up).

## talk-helper

A headless executable (no UI, no Keychain, no sign-in) that the Electron app's main process spawns and drives over stdin/stdout with newline-delimited JSON: **protocol v1, as specified in docs/desktop-plan.md "Helper protocol (v1)"**. stdout carries protocol lines only; logs go to stderr and os_log (subsystem `com.everyapp.talk`, category `helper`; never tokens). It exits cleanly (stopping a recording properly: last segments posted, `/finish` called) when stdin closes or on SIGTERM/SIGINT, within 45 s at most.

```sh
./scripts/build-helper.sh        # release, universal (arm64 + x86_64), signed → .build/helper/talk-helper
printf '{"id":1,"cmd":"hello","params":{"protocol":1}}\n{"id":2,"cmd":"permissions.status"}\n' | .build/helper/talk-helper
```

**For packaging (Lane A):** copy `mac/.build/helper/talk-helper` to `Talk.app/Contents/MacOS/talk-helper`. The script prints that path as its last stdout line. It signs with `TALK_SIGN_ID` if set (use the app's Developer ID; then a secure timestamp is added), else the self-signed "Scrawl Dev" cert if the keychain has it (a stable identity, so TCC grants survive rebuilds), else ad hoc. Always hardened runtime, entitlement `com.apple.security.device.audio-input`, identifier `com.everyapp.talk.helper`, with `Resources/helper-Info.plist` embedded in `__TEXT,__info_plist`. No notarization here: the app is notarized as a whole (re-sign the helper with the app's identity if electron-builder doesn't). `TALK_HELPER_ARCHS=arm64` builds one slice.

**TCC charges capture to the parent app.** macOS attributes the helper's mic and system-audio use to the responsible process, the Talk.app that launched it, so `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription` must be in **Talk.app's** Info.plist, and grants belong to Talk.app's identity (run from a terminal, they're Terminal's). The helper's embedded plist repeats the strings only for that terminal case.

How the helper reads the protocol where the table leaves room:

- `record.start` takes the meeting the app already created. Mic permission is asked there if never asked (`mic_denied` if refused). On failure nothing is left running, and the helper doesn't `/finish` the meeting (the app owns its lifecycle). Error codes: the Worker's `error` code when it gives one (e.g. `ai_provider_not_configured`), else `http_<status>`, `signed_out`, `access_login`, `capture_failed`, `start_failed`; also `busy`, `bad_params`, `shutting_down`.
- `record.stop` answers `{ segments }`: segments saved for the meeting during the recording. The final post waits for a periodic one still in flight, so `/finish` always comes after the last segments. If some couldn't be saved or `/finish` failed, an `error` event (`save_failed`) comes first; `not_recording` when idle.
- `record.stop` while `record.start` is still asking for the mic or fetching keys cancels the start: stop answers `{ segments: 0, cancelled: true }` at once, the start answers error `cancelled`, and no audio is captured (a pending `token.needed` wait fails at once). If capture had already begun, stop waits for the start and stops it normally.
- `permissions.request` answers the same `{ mic, systemAudio }` shape as `permissions.status`. `systemAudio` is always `unknown`: there's no API to read it, and `request` starts a 1 s tap so macOS shows its prompt.
- `transcript.delta.text` is the **whole text so far** of that `itemId` (replace, don't append). Fallback mode sends no deltas, only segments.
- `transcript.segment.seq` is the seq posted to the Worker (realtime), or the one the Worker stored (fallback).
- `state` is sent on start, stop, mode changes and health changes. `mic`/`system`: `error` when capture failed or couldn't restart, `silent` after 5 s of digital silence (a denied tap, a muted device, or simply nothing playing), else `ok`.
- `levels` at 10 Hz while recording: peak RMS per 100 ms on a −60…0 dBFS scale.
- `token.needed`: on a 401 from the Worker. The request waits up to 60 s for `token.update`, then is retried once; segments that still fail are kept and retried on the next 10 s tick (asking again).
- `error.fatal` is `false` for everything today (`transcription`, `capture`, `save_failed`, `fallback_backlog`); the recording goes on.
- Fallback uploads go one at a time, each attempt capped at 60 s (3 attempts). At most 8 MB (about 3 minutes) of chunks wait behind a slow upload, none older than 3 minutes; past that the oldest waiting chunks are dropped and an `error` event `fallback_backlog` says how much audio was lost. Stop drains at most that bounded queue.
- `device.changed` fires whenever the default input or output changes, recording or not, with the new device's name.
- `call.started`/`call.ended`: with `detect.set {enabled:true}` the helper polls Core Audio's process objects once a second (`kAudioHardwarePropertyProcessObjectList`, `kAudioProcessPropertyIsRunningInput`, bundle id). An app must hold the mic 3 s to start and release it 3 s to end. Known apps (helpers map to their app): Zoom (`us.zoom.xos`), Microsoft Teams, Slack, FaceTime (incl. `avconferenced`), Webex, Discord, and the browsers Chrome, Arc, Safari (incl. `com.apple.WebKit.GPU`), Edge, Firefox, Brave: for a browser the app decides whether it's a Meet call. Talk's own processes (`com.everyapp.talk*`, and the helper's pid) are ignored. Turning detection off doesn't send `call.ended`.
