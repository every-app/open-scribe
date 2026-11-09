# OpenScribe

OpenScribe is open-source AI meeting notes for Every App. In the product it's called **Scribe**.

It works like this: a macOS desktop app (Electron, with a native Swift helper for audio) reminds you when a meeting starts, records it (system audio plus the microphone) and transcribes it live with OpenAI; an Every App web app turns the transcript into notes with a template you pick, and keeps them in private and team folders. Notes are private by default, can be shared with the workspace, or published with a revocable link. Audio is never stored.

- `web/`: the Scribe web app on Every App (its hosted app id is still `talk`, see `web/everyapp.config.ts`) and the main window: upcoming meetings, folders, notes, templates, the `/api/v1` the Mac app calls, the shared pages.
- `packages/ui`: the component library and theme `web/` uses.
- **The Mac app moved** to [every-app/private-every-app](https://github.com/every-app/private-every-app/tree/main/apps/desktop) (`apps/desktop`). It's now Every App for Mac, with meeting notes as its Scribe feature: the Electron app, the Swift helper (now `everyapp-helper`), its screens, and its release docs (`apps/desktop/docs/release.md`). It still calls this app's `/api/v1` and update feed.
- `docs/SPEC.md`: the architecture, data model, API, web app, folders, templates, reminders, sign-in, sharing and permissions. `TODO.md` holds the decisions and open questions.

## Run it locally

Web, from `web/`:

```sh
pnpm install
pnpm dev          # http://talk.localhost:8787 (the URL follows the app id), signed in as a test user
pnpm test
```

The Mac app: see `apps/desktop/README.md` in every-app/private-every-app.
