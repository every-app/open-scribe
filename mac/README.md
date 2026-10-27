# OpenZen for Mac

The menu-bar recorder (docs/SPEC.md). SwiftUI `MenuBarExtra`, `LSUIElement`, macOS 15+, SwiftPM only (no Xcode project).

```sh
./scripts/build-app.sh      # build, sign, install ~/Applications/OpenZen.app, restart it
./scripts/test.sh           # unit tests (Swift Testing; works with only the Command Line Tools)
swift run openzen-smoke http://open-zen.localhost:8787 any-token   # API client against a running web/
```

`OPENZEN_NO_LAUNCH=1` builds and installs without restarting. `OPENZEN_CONFIG=release` builds optimized. `OPENZEN_DIAG=1` (when you run the binary directly) prints the app's windows, the status item's among them.

## Layout

| Path | What |
| --- | --- |
| `Sources/OpenZenCore` | No hardware, no UI, all tested: PKCE, the loopback redirect parser, the OAuth client, `AuthProvider`, `SignInFlow`, the API client and its lenient decoders, `SegmentBatcher`, `ChunkCutter`, `Resampler` (windowed sinc) and PCM16, `TurnDetector`, `ReminderPlanner`, WAV, the Keychain store |
| `Sources/OpenZen` | The app: menu, Settings (sign-in, permissions), Meetings window, `OAuthSignIn` (the loopback listener), `MicCapture` (AVAudioEngine), `SystemAudioCapture` (Core Audio process tap), `RealtimeSession`/`TranscriptionChannel`, `ChunkChannel` (fallback), `Recorder`, `Reminders` |
| `Resources` | Info.plist and entitlements, copied by the build script |

## Sign-in

`AuthProvider` hands the API client a bearer token, whatever kind of sign-in made it:

- **Access token** (works today): the app URL plus a personal access token, kept in the Keychain. Behind Cloudflare Access a bearer alone gets Access's login; the API client spots that (a redirect to, or a page from, `*.cloudflareaccess.com`, even on a 401/403) and says "Gateway requires Sign in with Every App" instead of signing out.
- **Every App** (the design's §12/§13; needs the Gateway's `feature/native-sign-in`): the person types the OpenZen app URL, the same field the token uses. `GET {app}/.well-known/oauth-protected-resource` (RFC 9728) must name the app's origin as `resource` and gives the Gateway (`authorization_servers[0]`); the Gateway's `/.well-known/oauth-authorization-server` must name the same `issuer`. The client registers once per install (redirect `http://127.0.0.1/callback`, any port), its id cached in the Keychain per issuer and re-registered only on `invalid_client`. PKCE S256, the system browser, a loopback listener on an ephemeral port that checks `state` and `iss`, then the token exchange. `resource={origin}` on authorize, token and refresh; no `scope` anywhere. Rotated refresh tokens are stored before the new access token is used; `invalid_grant` means sign in again; sign-out revokes the refresh token. The logic is `SignInFlow` in Core (tested); the app adds the browser and the listener.

## Recording

Mic and system audio are converted to PCM16 24 kHz mono on the Mac and streamed to two OpenAI Realtime transcription sockets (`me`, `them`), each with its own ephemeral key from `POST /api/v1/meetings/:id/transcription-token`. Turns are detected on the Mac (600 ms of silence or 30 s, Scrawl's rule). Finished segments are posted every 10 s and on stop, and the meeting is finished on stop. If the token route reports live keys unavailable (`ai_route_not_allowed`, or a 403/501/502/503 other than `ai_provider_not_configured`), both speakers switch to the fallback: chunks of up to 30 s, cut at a turn's end once 20 s have gathered (and silence dropped), are posted to `POST …/audio-chunk` as in-memory WAVs. Audio is never written to disk.

## Signing and permissions (Scrawl's lessons)

TCC ties microphone, system audio and notification grants to the bundle's path and code identity, so:

- The app always runs from `~/Applications/OpenZen.app`, never from `.build/`.
- It is signed with a stable certificate (`OPENZEN_SIGN_ID`, else a self-signed "OpenZen Dev" code-signing cert, else "Scrawl Dev" if present), with the hardened runtime and `com.apple.security.device.audio-input`. Ad-hoc signing works but makes macOS ask again after every rebuild.
- Permissions are asked from Settings or right before a recording starts, never from inside capture code. System audio has no ask/check API: macOS prompts the first time a process tap starts (Settings → "Allow…" starts a one-second tap to bring the prompt up).
