# Talk spec (v1)

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
                     │  app id: talk       │  sharing, API for the Mac app
                     └─────────▲──────────┘
         HTTPS, bearer token   │                 ▲  WebSocket, ephemeral key
                     ┌─────────┴──────────┐      │
                     │  mac/  (SwiftUI)    │──────┘ audio straight to OpenAI
                     │  menu bar, capture  │
                     └────────────────────┘
```

- **web/** is an Every App app (TanStack Start on a Worker, D1 through drizzle). It holds all data and every key-bearing call. It is the main window: a sidebar of folders, the coming week's meetings, the notes (see Web app below).
- **mac/** is a SwiftUI menu-bar app: it reminds you when a meeting starts and takes the notes. It never holds an API key. It calls `web/` over HTTPS with a bearer token, and streams audio to OpenAI with a short-lived key the Worker mints.
- Audio is never uploaded to the Worker and never stored. Only text leaves the Mac.

## How the Mac app signs in: Sign in with Every App

The person types the **app URL**, the one they use in the browser (`https://talk.<base>`). The Mac app signs in through the Gateway as an OAuth public client and gets a token bound to this one app. The platform side is `docs/design/native-sign-in.md` on private-every-app's `feature/native-sign-in` branch; this is Talk's side of it.

The flow (RFC 8252 native app, PKCE, no scope):

1. **Discover from the app.** `GET {origin}/.well-known/oauth-protected-resource` names the Gateway (`resource` = the origin, `authorization_servers[0]`). Then `GET {gateway}/.well-known/oauth-authorization-server` gives the authorize, token, revocation and registration endpoints.
2. **Register once per install.** `POST` the registration endpoint as a public client: `token_endpoint_auth_method: "none"`, `redirect_uris: ["http://127.0.0.1/callback"]` (loopback, any port), `client_name: "Talk for Mac"`. Keep the `client_id` in the Keychain. Later, a Client ID Metadata Document on our own domain puts a verified name on the consent page.
3. **Authorize** in the system browser with `code_challenge` (S256), a one-use `state` and `resource={origin}`. No `scope`: the binding is by resource. Cloudflare Access and the Gateway's consent page are ordinary web pages, so Access is no obstacle here. The browser comes back to the loopback listener with the code.
4. **Exchange** at the token endpoint with the verifier and the same `resource`: an access token good for an hour and a refresh token (30 days sliding, rotated on use).
5. **Call** `https://talk.<base>/api/v1/...` with `Authorization: Bearer <access token>`. The perimeter checks the audience is this host, re-reads the connection, and mints the usual identity: `chan: "api"`, `act.sub: "oauth:<id>"`, `scopes: ["*"]`. The app sees the member who consented. Refresh before expiry or on a 401; `invalid_grant` means sign in again.
6. **Sign out** revokes the refresh token. The person can also revoke it under Settings → Connections; removal, deactivation and 30 idle days end it too.

Talk's Worker changes nothing for this: its routes read the person with the SDK, so a PAT today and the native token later look the same. The API is plain route files under `/api/v1`, not server functions, because the Gateway admits only same-origin `fetch` to `/_serverFn/*`.

**Bearer routes.** Behind Cloudflare Access a bearer-only call gets Access's HTML login unless the app's manifest lists the paths under `bearerRoutes: { paths: ["/api/v1/**"], why }`; `everyapp access on` then bypasses them on the apps' Access application and the perimeter still demands the token. On those paths a session cookie is refused (401), so the bypass opens nothing to a browser: Talk's web UI uses server functions only, and the public `/s/:token` page and every page are outside `/api/v1/**`. Talk adds the field as soon as the SDK from `feature/native-sign-in` is published (a TODO in `web/everyapp.config.ts` marks the spot).

**Development.** `everyapp dev` runs in stub mode (any bearer is the dev user); mirror mode for native tokens is deferred, so the real token is tested against a deployed Gateway.

**Fallback that works today:** a **personal access token** (Manage workspace → Tokens → New token, Full access, bound to Talk) pasted into the Mac app and sent as `Authorization: Bearer epat_…`. Behind Access it still needs the same `bearerRoutes` bypass, and only owners and admins can make one.

## Data model (D1)

| Table                 | Columns                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meetings`            | `id`, `org_id`, `owner_user_id`, `owner_email?`, `title`, `starts_at`, `ends_at`, `calendar_event_id?`, `attendees?` (JSON `[{ email, name, self }]`), `template_id?`, `status` (`recording`, `processing`, `done`, `failed`), `visibility` (`private`, `team`), `created_at`, `updated_at` |
| `folders`             | `id`, `org_id`, `owner_user_id`, `space` (`private`, `team`), `name`, `default_template_id?`, `created_at`, `updated_at`                                                                                                                                                                    |
| `meeting_folders`     | `meeting_id`, `folder_id` (pk together), `added_by`, `added_at`                                                                                                                                                                                                                             |
| `templates`           | `id`, `org_id`, `owner_user_id`, `name`, `instructions`, `visibility` (`private`, `team`), `created_at`, `updated_at`; the built-in templates live in code                                                                                                                                  |
| `user_settings`       | `org_id`, `user_id` (pk together), `default_template_id?`, `updated_at`                                                                                                                                                                                                                     |
| `transcript_segments` | `id`, `meeting_id`, `seq`, `started_ms`, `ended_ms`, `speaker` (`me`, `them`, or null), `text`, `created_at`                                                                                                                                                                                |
| `notes`               | `meeting_id` (pk), `markdown`, `model`, `generated_at`, `edited_at?`                                                                                                                                                                                                                        |
| `share_links`         | `id` (32 random bytes, base64url), `meeting_id`, `created_by`, `created_at`, `revoked_at?`                                                                                                                                                                                                  |

Every query takes `org_id` and the user: private rows by `owner_user_id`, team rows by `org_id`. No table of users; identity is the Gateway's.

## API (bearer token; JSON)

| Route                                                                                 | Does                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me`                                                                      | `{ user: { id, email, orgName }, google: { connected, connectUrl } }`                                                                                                                                                                                                                 |
| `GET /api/v1/calendar/upcoming?hours=24`                                              | `{ events: [{ id, title, start, end, attendees: [{ email, self }], conferenceUrl, location }], connected }`; 409 with `connectUrl` when Google isn't connected                                                                                                                        |
| `POST /api/v1/meetings`                                                               | `{ title, startsAt?, calendarEventId?, attendees?: [{ email?, name?, self? }] }` → 201 `{ meeting: { id, … } }`                                                                                                                                                                       |
| `POST /api/v1/meetings/:id/transcription-token`                                       | `{ source?: "mic" \| "system" \| "mixed", language? }` → `{ value, expiresAt, model, sampleRate }`; 503 with the Gateway's setup sentence when OpenAI isn't set up                                                                                                                    |
| `POST /api/v1/meetings/:id/audio-chunk`                                               | the fallback: multipart `file` (WAV, ≤ 30 s, ≤ 25 MB) + `seq`, `startedMs`, `endedMs`, `speaker?`, `language?` → `{ segment }`; the Worker forwards the audio to `/v1/audio/transcriptions` through the Gateway (model `gpt-4o-mini-transcribe`), stores the text and drops the audio |
| `POST /api/v1/meetings/:id/segments`                                                  | a bare array or `{ segments }` of `{ seq, startedMs, endedMs, speaker, text }`                                                                                                                                                                                                        |
| `POST /api/v1/meetings/:id/finish`                                                    | stop; the Worker writes the notes in the background (`waitUntil`)                                                                                                                                                                                                                     |
| `GET /api/v1/meetings`, `GET /api/v1/meetings/:id`                                    | `{ meetings }`; `{ meeting }` with `segments`, `notes`, `shareLinks`                                                                                                                                                                                                                  |
| `PATCH /api/v1/meetings/:id`                                                          | `{ title?, visibility? }` (owner only)                                                                                                                                                                                                                                                |
| `POST /api/v1/meetings/:id/share` → `{ link: { id, url } }`, `DELETE …/share/:linkId` | make or revoke a public link (owner only)                                                                                                                                                                                                                                             |
| `GET /s/:token` (public route)                                                        | the shared page, read-only, `noindex`                                                                                                                                                                                                                                                 |

Every route answers JSON with `cache-control: no-store`; errors are `{ error, message? }` with 400, 401, 404, 409, 502, 503 or 500.

The web UI calls the same queries through server functions. Folders and templates have no `/api/v1` routes yet: the Mac app doesn't need them (the Worker picks the template when it writes the notes).

## Web app

The main window, built with the component library OpenCRM and OpenSEO use (shadcn on Base UI, Tailwind 4, lucide, sonner), light and dark following the system.

- **Sidebar:** Home, Shared with me; **My notes** (private folders) and the **team** space (team folders), each with a + for a new folder; Templates and Settings at the bottom.
- **Home:** _Coming up_, the next two weeks of the calendar three days at a time (arrows page through), each event with **Start now** (from ten minutes before until it ends; otherwise **Take notes** on hover), a join button when it has a call link, and **Open notes** once it has notes. Below, every meeting the person can read, grouped by day, with whose it is.
- **Shared with me:** team meetings other people own.
- **Folder:** its meetings by day, **Add notes** (pick from your meetings), remove from folder, rename, delete (the meetings stay), and the folder's notes template.
- **Meeting:** an editable title; chips for Notes/Transcript, date and guests, folders (tick to file or unfile) and the template (pick another to rewrite the notes); **Share** (team on/off, public links); delete.
- **Templates:** the built-ins and the team's and your own; new, edit, duplicate, delete, make default.
- **Settings:** account, Google Calendar, the Mac app's sign-in, the default template, light/dark.
- **New note** (top right) and the Start now / Take notes buttons open `talk://record…`, so the Mac app takes the notes; the browser never records.

## Folders

- A folder is in one space. **Private**: its creator's alone. **Team**: every member sees it, and anyone on the team can rename it, delete it, set its template, and file meetings in it.
- A meeting can be in several folders. Filing it in a team folder shares it with the team; only the owner can do that to a private meeting. Anyone can file a meeting the team can already see. A private folder takes any meeting you can read and shares nothing.
- Making a meeting private takes it out of every team folder. Taking it out of a folder changes nothing else.

## Templates

A template is a name and instructions (sections, detail, what to pull out) that go into the notes prompt. Built in: General (the default), 1:1, Customer call, Team meeting, Interview, Follow-up email. People add their own, private or for the team; only the owner edits one.

The notes use the first that applies, skipping any the meeting's owner may no longer use:

1. the template chosen on the meeting (before it ends, or after, which rewrites the notes);
2. the default of a folder the meeting is in: the earliest it was filed in, counting team folders and the owner's own;
3. the owner's default (Settings);
4. General.

When the notes are written the template is pinned on the meeting, so a later change to a default doesn't relabel them.

## Meeting reminders

1. Every 5 minutes, and on wake, the Mac app asks `/api/v1/calendar/upcoming`. The Worker calls `https://www.googleapis.com/calendar/v3/calendars/primary/events` with `integrationFetch({ provider: "google-workspace" })`; the Gateway puts the person's token on it. Not connected → the Mac app shows "Connect Google Calendar", which opens `connectUrl()` in the browser.
2. For each event that has other attendees or a conference link, it schedules a local notification (`UNUserNotificationCenter`) for one minute before the start: "Starts at 2:00 PM. Join and take notes?", with **Join & Take Notes** (when there's a call link: opens it and records) and **Take Notes**. Clicking the notification does the first.
3. If a meeting has started and Talk isn't taking notes, a second notification asks again ("… started. Take notes?") within its first minutes, once per meeting. A meeting Talk is already taking notes for gets neither.
4. Take Notes creates the meeting (with the event's guests) and starts capture. The menu-bar icon turns red. The menu shows the live transcript's last line and a Stop item.
5. `talk://record` (from the web app) takes notes now; `talk://record?event=<id>&title=…&start=…[&join=1]` takes notes for that event. Any web page can open such a link, so the Mac app starts at once only for an event in its own calendar list, and asks first otherwise.

Google Calendar is read-only through the Gateway's `google-workspace` client, scope set `calendar.read`. The manifest declares exactly that set.

## Live transcription

1. On start, the Mac app asks the Worker for a transcription token. The Worker posts through the Gateway to OpenAI: `POST /api/ai/openai/v1/realtime/client_secrets` with `session.type: "transcription"`, PCM 24 kHz, model `gpt-live-transcribe`, `turn_detection: null`, `expires_after: 7200 s` (the API's maximum). The answer is `{ value: "ek_…", expires_at }`; the key is good for that one session type only.
2. The Mac app opens `wss://api.openai.com/v1/realtime?intent=transcription` with `Authorization: Bearer ek_…`, sends `session.update`, then `input_audio_buffer.append` with base64 PCM16 24 kHz. Client-side voice detection commits a turn after 600 ms of silence or at 30 s (Scrawl's rule). Text arrives as `conversation.item.input_audio_transcription.delta` and `…completed`.
3. Two sessions: one for the microphone (speaker `me`), one for system audio (speaker `them`). That gives speaker labels for free, at twice the transcription cost. One mixed session is the cheaper option.
4. Segments are posted to the Worker every ten seconds and on stop. Past 2 hours the Mac app asks for a new key and reconnects.
5. Finish: the Worker reads the segments and asks OpenAI chat completions (through the Gateway, model from `ai.models`) for notes in Markdown, shaped by the meeting's template (see Templates). It saves them to `notes`, pins the template, and marks the meeting `done`.

**Verified against the platform:** `/v1/realtime/client_secrets` is not an inference route, so it needs both the manifest's `ai.routes: ["/v1/realtime/client_secrets"]` and the operator's Gateway setting `AI_PROXY_EXTRA_ROUTES` covering it (`echo "/v1/realtime/client_secrets" | everyapp secret set AI_PROXY_EXTRA_ROUTES`). Only `openai` supports extra routes. Note the Mac app's `/me` and `/upcoming` decoders are lenient, so the shapes above may grow fields. The route streams through the proxy unread, which is what we want. The setting is required once the manifest has `ai.routes`, so the app shows Needs setup until it's set.

**Fallback** (built, `POST /api/v1/meetings/:id/audio-chunk`): when the transcription-token route answers `ai_route_not_allowed`, the Mac app sends 30-second WAV chunks to the Worker, which forwards them to `/v1/audio/transcriptions` (an inference route, always allowed) and discards the audio. Near-live, no key on the Mac at all, one more hop.

## Sharing and visibility

- **Private** (default): the owner alone.
- **Team**: every member of the workspace who can open Talk (`org_id`). Filing a meeting in a team folder makes it team too. The Gateway's groups decide who can open the app, but an app can't read groups (the SDK has `listMembers()` only), so a finer unit than the workspace is a platform gap.
- **Public link**: an unguessable token, `https://talk.<base>/s/<token>`, read-only notes and transcript, `noindex`. Revoke deletes access at once; a meeting can have several links. Who can open an app host's public route is Access's business too: `public` routes are let through.
- **Later**: private sharing by email with a one-time code to people outside the workspace.

## Permissions (macOS)

| Permission                  | Why                        | How                                                                                                                                                                                           |
| --------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microphone                  | your voice                 | `AVCaptureDevice.requestAccess(for: .audio)`, `NSMicrophoneUsageDescription`                                                                                                                  |
| System Audio Recording Only | the other side of the call | Core Audio process tap (`CATapDescription`, `AudioHardwareCreateProcessTap`, macOS 14.2+), `NSAudioCaptureUsageDescription`. No Screen Recording prompt; ScreenCaptureKit audio would need it |
| Notifications               | the reminder               | `UNUserNotificationCenter.requestAuthorization`                                                                                                                                               |

Lessons kept from Scrawl: the app must be a signed `.app` bundle at a stable path with a stable identity (ad-hoc signing loses TCC grants every rebuild), `LSUIElement` for no Dock icon, hardened runtime with `com.apple.security.device.audio-input`, and no permission prompts from inside capture code. Minimum macOS 15.

## v1 and later

v1: menu bar app, Sign in with Every App (token paste as the fallback), calendar reminders that offer to join and take notes, one-click notes, live transcription, notes from templates, folders (private and team), private and team visibility, public links, web UI.

Left out on purpose: chat over notes, typed notes enhanced by AI, integrations beyond Google Calendar, invites (Every App's), avatars.

Later: email sharing with one-time code; speaker names from attendees; editing notes; search; per-group sharing if the platform exposes groups; Windows.
