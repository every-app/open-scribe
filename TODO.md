# TODO

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

## Questions for Ben

- **Set the Gateway's OpenAI settings for live transcription?** The Gateway needs `OPENAI_API_KEY` and `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`. Recommended: yes. Without them, the Mac app falls back to 30 s chunks.
- **Which notes model?** The template picked `gpt-6-luna` in `ai.models`. Recommended: keep it; it's one line to change.
- **Should the platform support native sign-in at all?** (See private-every-app #855 and its TODO section for the full list.) Recommended: yes. It reuses the existing OAuth server with a per-app audience, so there's no new credential or store.
- **Should apps be able to read workspace groups?** Without it, OpenZen's "team" is the whole workspace. Recommended: later, as a platform item; not needed for v1.
- **Echo on laptop speakers:** without headphones, the mic also hears the other side, so `me` transcribes `them`. Recommended: try AVAudioEngine voice processing in a hardware test and turn it on if capture stays clean.
- **Mac signing identity:** reuse "Scrawl Dev" locally, a separate "OpenZen Dev" cert, or a Developer ID? Recommended: keep Scrawl Dev for now; get a Developer ID before anyone else installs it.
- **Should Record on a reminder also open the conference link?** Recommended: no for v1; the menu has "Join Call".
