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

## Questions for Ben

- **Set the Gateway's OpenAI settings for live transcription?** The Gateway needs `OPENAI_API_KEY` and `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`. Recommended: yes. Without them, the Mac app falls back to 30 s chunks.
- **Which notes model?** The template picked `gpt-6-luna` in `ai.models`. Recommended: keep it; it's one line to change.
- **Should the platform support native sign-in at all?** (See private-every-app #855 and its TODO section for the full list.) Recommended: yes. It reuses the existing OAuth server with a per-app audience, so there's no new credential or store.
- **Should apps be able to read workspace groups?** Without it, OpenZen's "team" is the whole workspace. Recommended: later, as a platform item; not needed for v1.
