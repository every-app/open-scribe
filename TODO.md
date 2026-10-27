# TODO

## Status for Ben (2026-10-27)

**Works**
- OpenZen web (`web/`, app id `open-zen`): D1, the full `/api/v1`, notes polish, private/team visibility, public links with revoke, a web UI. 7 tests. Runs with `everyapp dev`.
- OpenZen Mac (`mac/`, SwiftPM): menu bar, reminders, mic + system-audio capture, two-stream Realtime transcription, a chunked fallback, launch at login. 88 tests. `mac/scripts/build-app.sh`.
- Sign in with Every App, end to end on a real Gateway (loop-1, now torn down): sign-in, refresh, revoke, refused on other apps and on /mcp, and bearer calls working behind Access. Branch `feature/native-sign-in`, draft PR every-app/private-every-app#855 (all green, never merged). Design: docs/design/native-sign-in.md; review: docs/design/native-sign-in-review.md (0 high/medium).

**Not verified**
- Real audio capture, permission prompts, notifications and live OpenAI transcription: no hardware interaction or OpenAI key here.
- Google Calendar: no Google client configured on any Gateway.
- The browser Access login (one-time PIN) inside sign-in.

**Ben decides** (details below and in #855's TODO.md)
1. Should the platform support native sign-in at all? Recommended: yes.
2. A Developer ID for the Mac app (needed so updates keep the sign-in).
3. Set OPENAI_API_KEY + AI_PROXY_EXTRA_ROUTES on the Gateway; set up Google (setup/google.md).

## Decided for Ben

- **Lanes run in parallel in one local checkout.** web/ and mac/ have separate owners. No GitHub repo yet; everything is local commits on main.
- **Mac sign-in has two providers.** It ships the interim PAT paste (works with today's platform) and "Sign in with Every App" (OAuth, PKCE, loopback), which needs the private-every-app feature branch.
- **The product is renamed to OpenZen**, with app id `open-zen`, on macOS 15+. The folder rename to ~/workspaces/open-zen waits until no thread runs in it.

- **Cloudflare Access is on.** Setup forces it and everyapp.team uses it, so Sign in with Every App must work behind Access. PAT sign-in stays as the fallback.
- **Live transcription uses an OpenAI Realtime client secret**, which needs the manifest's `ai.routes: ["/v1/realtime/client_secrets"]` and the Gateway setting `AI_PROXY_EXTRA_ROUTES`. The fallback is 30 s chunks through the Worker to `/v1/audio/transcriptions`.
- **Two transcription streams**, mic = `me` and system audio = `them`, which gives speaker labels at twice the cost.
- **Reminders** go out 2 min before events that have attendees or a conference link.
- **Team means the whole workspace.** Apps can't read groups yet.
- **A public link shows both the notes and the transcript.**
- **Google Calendar isn't configured on any Gateway yet.** Ben follows setup/google.md with the `google-workspace` client and the `calendar.read` scope set.

- **Sign in with Every App is built on private-every-app's `feature/native-sign-in`**, which is never merged. Draft PR #855; design in docs/design/native-sign-in.md; Ben's platform questions are in that branch's TODO.md.
- **Mac app build:** native SwiftPM (no Xcode project), Swift 5 language mode, Swift Testing. It's signed with `OPENZEN_SIGN_ID`, else "OpenZen Dev", else Scrawl's "Scrawl Dev" cert (used today so TCC grants survive rebuilds), else ad hoc.
- **Mac transcription:** one ephemeral key per channel, two per meeting. Scrawl's session.update shape. Its own windowed-sinc resampler (testable). Echo cancellation off until a hardware test.
- **Mac reminders:** for events with a conference link or any attendee who isn't you. An event already inside the 2-minute window gets one immediate reminder. Ad hoc meetings are titled "Meeting at 3:04 PM".
- **Mac fallback:** each detected turn (≤30 s) goes as an in-memory WAV to the Worker, which drops it after transcription.
- **The end-to-end sign-in test runs on the onboarding loop's test account (loop-1)**, with the Gateway deployed from `feature/native-sign-in`. Local `everyapp dev` can't verify the new token (mirror mode is deferred in the design).
- **Fallback chunks are ≥20 s, cut at a turn end, max 30 s**, not a fixed 30 s, so words aren't split mid-sentence.
- **The Mac app treats a Cloudflare Access redirect or login page as "needs Sign in with Every App"**, never as a sign-out.
- **The Mac mic follows the system default input,** including hot-plug (e.g. AirPods mid-meeting); system audio follows the default output. A Launch at login toggle exists (reminders only arrive while OpenZen runs).
- **OpenZen requires OpenAI to open, for now.** `ai.routes` always makes `AI_PROXY_EXTRA_ROUTES` a required setting (packages/sdk appSettings.ts), so an optional provider wouldn't help. The operator sets `OPENAI_API_KEY` and `AI_PROXY_EXTRA_ROUTES` once.

## Questions for Ben

- **Set the Gateway's OpenAI settings for live transcription?** The Gateway needs `OPENAI_API_KEY` and `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`. Recommended: yes. Without them, the Mac app falls back to 30 s chunks.
- **Which notes model?** The template picked `gpt-6-luna` in `ai.models`. Recommended: keep it; it's one line to change.
- **Should the platform support native sign-in at all?** (See private-every-app #855 and its TODO section for the full list.) Recommended: yes. It reuses the existing OAuth server with a per-app audience, so there's no new credential or store.
- **Should apps be able to read workspace groups?** Without it, OpenZen's "team" is the whole workspace. Recommended: later, as a platform item; not needed for v1.
- **Echo on laptop speakers:** without headphones, the mic also hears the other side, so `me` transcribes `them`. Recommended: try AVAudioEngine voice processing in a hardware test and turn it on if capture stays clean.
- **A Developer ID (Team ID) is required to release the Mac app.** With a self-signed cert, the Keychain partition is the binary's cdhash, so every update signs the user out (found in the e2e run; TCC grants survive, Keychain items don't). Recommended: yes, get a Developer ID before any release; dev rebuilds keep re-signing in with `openzen-smoke signin`.
- **Should Record on a reminder also open the conference link?** Recommended: no for v1; the menu has "Join Call".
- **A mic picker in the Mac app?** Recommended: no for v1. Following the system default is what people expect from a call app.
- **Let `ai.routes` be optional in the platform**, with the same need fields as providers? Then an app like OpenZen opens without AI set up and falls back gracefully. Recommended: yes, as a small platform change after launch, kept out of the sign-in branch.
- **Gateway "Apps on your devices" table: hidden until a native app has signed in?** Recommended: yes (it's on the feature branch).
- **Gateway local dev in ~/.t3 worktrees:** Vite won't serve files under a hidden folder. Recommended: add the repo root to the gateway's Vite allowed paths (a dev-only fix on main).
- **Managed OAuth and bearer routes:** bearer routes stay bypassed with Access Managed OAuth on, but native sign-in needs Managed OAuth off. Recommended: document it, don't enforce it.
- **"Apps on your devices" keeps a signed-out device listed for up to ~5 min** (a grant grace period plus KV list lag). Recommended: accept for now; filter revoked grants in the list later.
