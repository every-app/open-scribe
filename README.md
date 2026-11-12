# OpenScribe

Open-source AI meeting notes for [Every App](https://everyapp.com). In the product it's called **Scribe**.

Every App for Mac reminds you when a meeting starts, records it (system audio plus the microphone) and transcribes it live with OpenAI. This app, which runs on your own Every App Gateway, turns the transcript into notes with a template you pick, and keeps them in private and team folders. Notes are private by default, can be shared with the workspace, or published with a revocable link. Audio is never stored.

It is an early alpha.

## Install

You need an Every App Gateway on your Cloudflare account ([everyapp.com/docs/gateway](https://everyapp.com/docs/gateway)) and an OpenAI API key.

```sh
npm install -g everyapp
everyapp setup            # once, if you have no Gateway yet
everyapp install https://github.com/every-app/open-scribe
everyapp configure scribe # asks for what Scribe needs
```

- `OPENAI_API_KEY`: transcribes the meeting and writes the notes.
- `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`: lets the Mac app transcribe live. Without it, the Mac app sends 30-second chunks instead.
- Google Calendar is optional (the Gateway's `google-workspace` client, `calendar.readonly`): it is what the meeting reminders read.

Meetings are recorded by Every App for Mac, whose source is in [every-app/every-app](https://github.com/every-app/every-app/tree/main/apps/desktop) (`apps/desktop`). It signs in to your Gateway and calls this app's `/api/v1`.

## What's here

- `web/`: the Scribe web app (app id `scribe`; it was `talk`, see `previousIds` in `web/everyapp.config.ts`): upcoming meetings, folders, notes, templates, the shared pages, and the `/api/v1` the Mac app calls. [web/README.md](web/README.md) has the details.
- `packages/ui`: the component library and theme `web/` uses.
- [docs/SPEC.md](docs/SPEC.md): the architecture, data model, API, folders, templates, reminders, sign-in, sharing and permissions.
- [TODO.md](TODO.md): the working notes: decisions made and questions still open.

## Run it locally

From `web/`:

```sh
pnpm install
pnpm dev          # http://scribe.localhost:8787 (the URL follows the app id), signed in as a test user
pnpm test
```

## License

[MIT](LICENSE)
