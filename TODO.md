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

## Questions for Ben

(Filled in as threads report.)
