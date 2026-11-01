# Talk for Mac

The menu-bar recorder (docs/SPEC.md). SwiftUI `MenuBarExtra`, `LSUIElement`, macOS 15+, SwiftPM only (no Xcode project).

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
| `Sources/Talk` | The app: menu, Settings (sign-in, permissions), `OAuthSignIn` (the loopback listener), `MicCapture` (AVAudioEngine), `SystemAudioCapture` (Core Audio process tap), `RealtimeSession`/`TranscriptionChannel`, `ChunkChannel` (fallback), `Recorder`, `Reminders`, the talk:// handler (`AppDelegate`, `AppModel.handle`) |
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
