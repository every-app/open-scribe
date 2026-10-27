# OpenZen spec (v1)

A meeting recorder for Every App: a native macOS menu-bar app records a meeting, transcribes it live, and a web app turns the transcript into notes that stay private unless you share them.

## Architecture

```
Google Calendar ──(held token)──┐
OpenAI (Realtime, chat) ──(key)─┤
                                ▼
                     ┌────────────────────┐
                     │  Every App Gateway  │  sign-in, identity, keys, OAuth
                     └─────────┬──────────┘
                               │ identity JWT / brokered calls
                     ┌─────────▼──────────┐
                     │  web/  (Worker+D1)  │  meetings, transcripts, notes,
                     │  app id: open-zen │  sharing, API for the Mac app
                     └─────────▲──────────┘
         HTTPS, bearer token   │                 ▲  WebSocket, ephemeral key
                     ┌─────────┴──────────┐      │
                     │  mac/  (SwiftUI)    │──────┘ audio straight to OpenAI
                     │  menu bar, capture  │
                     └────────────────────┘
```

- **web/** is an Every App app (TanStack Start on a Worker, D1 through drizzle). It holds all data and every key-bearing call. The browser UI lists meetings, shows notes and transcript, sets visibility and share links, and connects Google.
- **mac/** is a SwiftUI menu-bar app. It never holds an API key. It calls `web/` over HTTPS with a bearer token, and streams audio to OpenAI with a short-lived key the Worker mints.
- Audio is never uploaded to the Worker and never stored. Only text leaves the Mac.

## How the Mac app signs in: Sign in with Every App

The person types their Gateway URL. The Mac app signs in through it with OAuth as a public client and gets a token that works against OpenZen's API. The platform side is built on private-every-app's `feature/native-sign-in` branch; this section is OpenZen's side of the contract and the exact list of what it needs.

The flow (RFC 8252 native app, PKCE):

1. **Discover.** `GET <gateway>/.well-known/oauth-authorization-server` (RFC 8414): the authorize, token, registration and revocation endpoints. The Gateway already serves this for MCP clients.
2. **Register once.** `POST /oauth/register` (RFC 7591) as a public client: `token_endpoint_auth_method: "none"`, `redirect_uris: ["http://127.0.0.1/callback"]` (loopback, any port, RFC 8252 §7.3), `client_name: "OpenZen for Mac"`. The Mac app keeps the `client_id` in the Keychain.
3. **Authorize.** The default browser opens `/oauth/authorize` with `code_challenge` (S256), a one-use `state`, `resource=https://open-zen.<base>` (RFC 8707) and `scope=app:open-zen`. Cloudflare Access and the Gateway's consent page are ordinary web pages, so Access is no obstacle here. The browser comes back to the loopback listener with the code.
4. **Exchange.** `POST /oauth/token` with the verifier. The answer is a short-lived access token and a refresh token.
5. **Call.** Every API call is `Authorization: Bearer <access token>` to `https://open-zen.<base>/api/v1/...`. On 401 the Mac app refreshes once, then signs the person out.
6. **Sign out.** `POST` the revocation endpoint; the Gateway's Connected AI clients page lists and revokes the grant too, and deactivating the person revokes it.

OpenZen's Worker changes nothing for this: its routes read the person with the SDK, so whatever identity the perimeter mints for the token is the user. The API is plain route files under `/api/v1`, not server functions, because the Gateway admits only same-origin `fetch` to `/_serverFn/*`.

**What OpenZen needs from the platform** (each is missing today, verified in the checkout on 2026-10-27):

| #   | Need                                                                                                                                                                                                                                                                                                                         | Today                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | The perimeter accepts a Gateway-issued OAuth access token on an app host's private routes, minting an identity for that person (`chan: "api"` or a new channel, `act.sub: "oauth:<id>"`, `scopes: ["*"]` for that one app)                                                                                                   | An OAuth-shaped bearer on an app host is `401 unauthenticated`; only `epat_` tokens and sessions open app routes          |
| 2   | A token scoped to one app (`scope=app:<id>` or `resource=<app host>`), refused on every other app, like a bound personal token                                                                                                                                                                                               | OAuth tokens carry `mcp:` scopes only and open `/mcp` alone                                                               |
| 3   | Dynamic registration of a public native client with loopback redirect URIs and `token_endpoint_auth_method: none`                                                                                                                                                                                                            | Registration exists for MCP clients; loopback URIs and app scopes unverified                                              |
| 4   | Cloudflare Access lets the app's API paths through for bearer calls, the way `access on` bypasses `/mcp` on hosts whose manifest sets `mcp`: a manifest opt-in (say `nativeClients: { paths: ["/api/**"], why }`) that becomes a path override on the apps' Access application, with the perimeter still demanding the token | A bearer alone to an app host behind Access gets the Access login page; the service-token workaround is "unverified live" |
| 5   | Any member can approve a native app, as any member connects an AI client                                                                                                                                                                                                                                                     | Personal access tokens are created on an owner/admin page (`tokens.tsx` TODO)                                             |
| 6   | Revocation: the token on the Connected AI clients page, a revocation endpoint, and deactivation revoking it                                                                                                                                                                                                                  | Exists for MCP connections; must cover app-scoped grants                                                                  |
| 7   | `everyapp dev` mirror mode verifies the new token on app routes; stub mode keeps "any bearer is the dev user"                                                                                                                                                                                                                | Stub works today; mirror forwards `epat_` only                                                                            |
| 8   | Short access tokens (an hour or less) with rotating refresh tokens, so a stolen token is worth little                                                                                                                                                                                                                        | Whatever the OAuth server's defaults are                                                                                  |

Fallback that works today: a **personal access token** (Manage workspace → Tokens → New token, Full access, bound to OpenZen) pasted into the Mac app and sent as `Authorization: Bearer epat_…`. It needs Access off or an Access service token alongside, and only owners and admins can make one.

## Data model (D1)

| Table                 | Columns                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meetings`            | `id`, `org_id`, `owner_user_id`, `title`, `starts_at`, `ends_at`, `calendar_event_id?`, `status` (`recording`, `processing`, `done`, `failed`), `visibility` (`private`, `team`), `created_at`, `updated_at` |
| `transcript_segments` | `id`, `meeting_id`, `seq`, `started_ms`, `ended_ms`, `speaker` (`me`, `them`, or null), `text`, `created_at`                                                                                                 |
| `notes`               | `meeting_id` (pk), `markdown`, `model`, `generated_at`, `edited_at?`                                                                                                                                         |
| `share_links`         | `id` (32 random bytes, base64url), `meeting_id`, `created_by`, `created_at`, `revoked_at?`                                                                                                                   |

Every query takes `org_id` and the user: private rows by `owner_user_id`, team rows by `org_id`. No table of users; identity is the Gateway's.

## API (bearer token; JSON)

| Route                                                                                 | Does                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me`                                                                      | `{ user: { id, email, orgName }, google: { connected, connectUrl } }`                                                                                                                                                                                                                 |
| `GET /api/v1/calendar/upcoming?hours=24`                                              | `{ events: [{ id, title, start, end, attendees: [{ email, self }], conferenceUrl, location }], connected }`; 409 with `connectUrl` when Google isn't connected                                                                                                                        |
| `POST /api/v1/meetings`                                                               | `{ title, startsAt?, calendarEventId? }` → 201 `{ meeting: { id, … } }`                                                                                                                                                                                                               |
| `POST /api/v1/meetings/:id/transcription-token`                                       | `{ source?: "mic" \| "system" \| "mixed", language? }` → `{ value, expiresAt, model, sampleRate }`; 503 with the Gateway's setup sentence when OpenAI isn't set up                                                                                                                    |
| `POST /api/v1/meetings/:id/audio-chunk`                                               | the fallback: multipart `file` (WAV, ≤ 30 s, ≤ 25 MB) + `seq`, `startedMs`, `endedMs`, `speaker?`, `language?` → `{ segment }`; the Worker forwards the audio to `/v1/audio/transcriptions` through the Gateway (model `gpt-4o-mini-transcribe`), stores the text and drops the audio |
| `POST /api/v1/meetings/:id/segments`                                                  | a bare array or `{ segments }` of `{ seq, startedMs, endedMs, speaker, text }`                                                                                                                                                                                                        |
| `POST /api/v1/meetings/:id/finish`                                                    | stop; the Worker writes the notes in the background (`waitUntil`)                                                                                                                                                                                                                     |
| `GET /api/v1/meetings`, `GET /api/v1/meetings/:id`                                    | `{ meetings }`; `{ meeting }` with `segments`, `notes`, `shareLinks`                                                                                                                                                                                                                  |
| `PATCH /api/v1/meetings/:id`                                                          | `{ title?, visibility? }` (owner only)                                                                                                                                                                                                                                                |
| `POST /api/v1/meetings/:id/share` → `{ link: { id, url } }`, `DELETE …/share/:linkId` | make or revoke a public link (owner only)                                                                                                                                                                                                                                             |
| `GET /s/:token` (public route)                                                        | the shared page, read-only, `noindex`                                                                                                                                                                                                                                                 |

Every route answers JSON with `cache-control: no-store`; errors are `{ error, message? }` with 400, 401, 404, 409, 502, 503 or 500.

The web UI calls the same queries through server functions.

## Meeting reminder

1. Every 5 minutes, and on wake, the Mac app asks `/api/v1/calendar/upcoming`. The Worker calls `https://www.googleapis.com/calendar/v3/calendars/primary/events` with `integrationFetch({ provider: "google-workspace" })`; the Gateway puts the person's token on it. Not connected → the Mac app shows "Connect Google Calendar", which opens `connectUrl()` in the browser.
2. For each event that has other attendees or a conference link, it schedules a local notification (`UNUserNotificationCenter`) for two minutes before the start, with one action: **Record**.
3. Record creates the meeting and starts capture. The menu-bar icon turns red. The menu shows the live transcript's last line and a Stop item.

Google Calendar is read-only through the Gateway's `google-workspace` client, scope set `calendar.read`. The manifest declares exactly that set.

## Live transcription

1. On start, the Mac app asks the Worker for a transcription token. The Worker posts through the Gateway to OpenAI: `POST /api/ai/openai/v1/realtime/client_secrets` with `session.type: "transcription"`, PCM 24 kHz, model `gpt-live-transcribe`, `turn_detection: null`, `expires_after: 7200 s` (the API's maximum). The answer is `{ value: "ek_…", expires_at }`; the key is good for that one session type only.
2. The Mac app opens `wss://api.openai.com/v1/realtime?intent=transcription` with `Authorization: Bearer ek_…`, sends `session.update`, then `input_audio_buffer.append` with base64 PCM16 24 kHz. Client-side voice detection commits a turn after 600 ms of silence or at 30 s (Scrawl's rule). Text arrives as `conversation.item.input_audio_transcription.delta` and `…completed`.
3. Two sessions: one for the microphone (speaker `me`), one for system audio (speaker `them`). That gives speaker labels for free, at twice the transcription cost. One mixed session is the cheaper option.
4. Segments are posted to the Worker every ten seconds and on stop. Past 2 hours the Mac app asks for a new key and reconnects.
5. Finish: the Worker reads the segments and asks OpenAI chat completions (through the Gateway, model from `ai.models`) for notes in Markdown: summary, key points, decisions, action items. It saves them to `notes` and marks the meeting `done`.

**Verified against the platform:** `/v1/realtime/client_secrets` is not an inference route, so it needs both the manifest's `ai.routes: ["/v1/realtime/client_secrets"]` and the operator's Gateway setting `AI_PROXY_EXTRA_ROUTES` covering it (`echo "/v1/realtime/client_secrets" | everyapp secret set AI_PROXY_EXTRA_ROUTES`). Only `openai` supports extra routes. Note the Mac app's `/me` and `/upcoming` decoders are lenient, so the shapes above may grow fields. The route streams through the proxy unread, which is what we want. The setting is required once the manifest has `ai.routes`, so the app shows Needs setup until it's set.

**Fallback** (built, `POST /api/v1/meetings/:id/audio-chunk`): when the transcription-token route answers `ai_route_not_allowed`, the Mac app sends 30-second WAV chunks to the Worker, which forwards them to `/v1/audio/transcriptions` (an inference route, always allowed) and discards the audio. Near-live, no key on the Mac at all, one more hop.

## Sharing and visibility

- **Private** (default): the owner alone.
- **Team**: every member of the workspace who can open OpenZen (`org_id`). The Gateway's groups decide who can open the app, but an app can't read groups (the SDK has `listMembers()` only), so a finer unit than the workspace is a platform gap.
- **Public link**: an unguessable token, `https://open-zen.<base>/s/<token>`, read-only notes and transcript, `noindex`. Revoke deletes access at once; a meeting can have several links. Who can open an app host's public route is Access's business too: `public` routes are let through.
- **Later**: private sharing by email with a one-time code to people outside the workspace.

## Permissions (macOS)

| Permission                  | Why                        | How                                                                                                                                                                                           |
| --------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microphone                  | your voice                 | `AVCaptureDevice.requestAccess(for: .audio)`, `NSMicrophoneUsageDescription`                                                                                                                  |
| System Audio Recording Only | the other side of the call | Core Audio process tap (`CATapDescription`, `AudioHardwareCreateProcessTap`, macOS 14.2+), `NSAudioCaptureUsageDescription`. No Screen Recording prompt; ScreenCaptureKit audio would need it |
| Notifications               | the reminder               | `UNUserNotificationCenter.requestAuthorization`                                                                                                                                               |

Lessons kept from Scrawl: the app must be a signed `.app` bundle at a stable path with a stable identity (ad-hoc signing loses TCC grants every rebuild), `LSUIElement` for no Dock icon, hardened runtime with `com.apple.security.device.audio-input`, and no permission prompts from inside capture code. Minimum macOS 15.

## v1 and later

v1: menu bar app, Sign in with Every App (token paste as the fallback), calendar reminders, one-click record, live transcription, notes, private and team visibility, public links, web UI.

Later: email sharing with one-time code; speaker names from attendees; editing notes; search; per-group sharing if the platform exposes groups; Windows.
