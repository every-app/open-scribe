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

## How the Mac app signs in

Two ways, decided for Ben (TODO.md):

1. **Sign in with Every App** (the goal): the Mac app asks for the Gateway URL, registers as a public OAuth client, and signs in with PKCE and a loopback redirect. That needs platform work on private-every-app's `feature/native-sign-in` branch: today the Gateway's OAuth tokens open only its `/mcp`, and a bearer alone hits Cloudflare Access's login on an app host. The design lives there, not here.
2. **A personal access token** (works today): Manage workspace → Tokens → New token, Full access, bound to OpenZen, expiry up to a year. The Mac app keeps it in the Keychain and sends `Authorization: Bearer epat_…`. The perimeter admits it to every private route as that person (`channel: "api"`); the app reads the user with the SDK as for a browser. A 401 sends the person back to sign-in.

The API is plain route files under `/api/v1`, not server functions: the Gateway only admits same-origin `fetch` to `/_serverFn/*`.

What the platform is missing (inputs for the feature branch):

- The Tokens page is owner/admin-gated (`tokens.tsx` carries a TODO to move it to a member page), so a plain member can't make a token today.
- No device or OAuth flow for native clients to app hosts; an MCP-style OAuth token is refused on app routes by design.
- Behind Cloudflare Access a bearer alone gets Access's login page on app hosts; the documented workaround (an Access service token alongside) is marked "unverified live".

## Data model (D1)

| Table | Columns |
| --- | --- |
| `meetings` | `id`, `org_id`, `owner_user_id`, `title`, `starts_at`, `ends_at`, `calendar_event_id?`, `status` (`recording`, `processing`, `done`, `failed`), `visibility` (`private`, `team`), `created_at`, `updated_at` |
| `transcript_segments` | `id`, `meeting_id`, `seq`, `started_ms`, `ended_ms`, `speaker` (`me`, `them`, or null), `text`, `created_at` |
| `notes` | `meeting_id` (pk), `markdown`, `model`, `generated_at`, `edited_at?` |
| `share_links` | `id` (32 random bytes, base64url), `meeting_id`, `created_by`, `created_at`, `revoked_at?` |

Every query takes `org_id` and the user: private rows by `owner_user_id`, team rows by `org_id`. No table of users; identity is the Gateway's.

## API (bearer token; JSON)

| Route | Does |
| --- | --- |
| `GET /api/v1/me` | `{ user: { id, email, orgName }, google: { connected, connectUrl } }` |
| `GET /api/v1/calendar/upcoming?hours=24` | `{ events: [{ id, title, start, end, attendees: [{ email, self }], conferenceUrl, location }], connected }`; 409 with `connectUrl` when Google isn't connected |
| `POST /api/v1/meetings` | `{ title, startsAt?, calendarEventId? }` → 201 `{ meeting: { id, … } }` |
| `POST /api/v1/meetings/:id/transcription-token` | `{ source?: "mic" \| "system" \| "mixed", language? }` → `{ value, expiresAt, model, sampleRate }`; 503 with the Gateway's setup sentence when OpenAI isn't set up |
| `POST /api/v1/meetings/:id/segments` | a bare array or `{ segments }` of `{ seq, startedMs, endedMs, speaker, text }` |
| `POST /api/v1/meetings/:id/finish` | stop; the Worker writes the notes in the background (`waitUntil`) |
| `GET /api/v1/meetings`, `GET /api/v1/meetings/:id` | `{ meetings }`; `{ meeting }` with `segments`, `notes`, `shareLinks` |
| `PATCH /api/v1/meetings/:id` | `{ title?, visibility? }` (owner only) |
| `POST /api/v1/meetings/:id/share` → `{ link: { id, url } }`, `DELETE …/share/:linkId` | make or revoke a public link (owner only) |
| `GET /s/:token` (public route) | the shared page, read-only, `noindex` |

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

**Fallback** if Ben won't set the extra route: the Mac app sends 30-second WAV chunks to the Worker, which forwards them to `/v1/audio/transcriptions` (an inference route) and discards the audio. Near-live, no key on the Mac at all, one more hop.

## Sharing and visibility

- **Private** (default): the owner alone.
- **Team**: every member of the workspace who can open OpenZen (`org_id`). The Gateway's groups decide who can open the app, but an app can't read groups (the SDK has `listMembers()` only), so a finer unit than the workspace is a platform gap.
- **Public link**: an unguessable token, `https://open-zen.<base>/s/<token>`, read-only notes and transcript, `noindex`. Revoke deletes access at once; a meeting can have several links. Who can open an app host's public route is Access's business too: `public` routes are let through.
- **Later**: private sharing by email with a one-time code to people outside the workspace.

## Permissions (macOS)

| Permission | Why | How |
| --- | --- | --- |
| Microphone | your voice | `AVCaptureDevice.requestAccess(for: .audio)`, `NSMicrophoneUsageDescription` |
| System Audio Recording Only | the other side of the call | Core Audio process tap (`CATapDescription`, `AudioHardwareCreateProcessTap`, macOS 14.2+), `NSAudioCaptureUsageDescription`. No Screen Recording prompt; ScreenCaptureKit audio would need it |
| Notifications | the reminder | `UNUserNotificationCenter.requestAuthorization` |

Lessons kept from Scrawl: the app must be a signed `.app` bundle at a stable path with a stable identity (ad-hoc signing loses TCC grants every rebuild), `LSUIElement` for no Dock icon, hardened runtime with `com.apple.security.device.audio-input`, and no permission prompts from inside capture code. Minimum macOS 15.

## v1 and later

v1: menu bar app, token sign-in, calendar reminders, one-click record, live transcription, notes, private and team visibility, public links, web UI.

Later: email sharing with one-time code; speaker names from attendees; editing notes; search; per-group sharing if the platform exposes groups; a device-link sign-in if the platform adds a native-client flow; Windows.
