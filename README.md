# Talk

Meeting notes for Every App: a native macOS menu-bar app reminds you when a meeting starts, records it (system audio plus the microphone) and transcribes it live with OpenAI; an Every App web app turns the transcript into notes with a template you pick, and keeps them in private and team folders. Notes are private by default, can be shared with the workspace, or published with a revocable link. Audio is never stored.

- `web/`: the Every App app (app id `talk`) and the main window: upcoming meetings, folders, notes, templates, the `/api/v1` the Mac app calls, the shared pages.
- `mac/`: Talk for Mac, a SwiftUI menu-bar app (Swift Package).
- `docs/SPEC.md`: the architecture, data model, API, web app, folders, templates, reminders, sign-in, sharing and permissions. `TODO.md` holds the decisions and open questions.

## Run it locally

Web, from `web/`:

```sh
pnpm install
pnpm dev          # http://talk.localhost:8787, signed in as a test user
pnpm test
```

Mac, from `mac/`:

```sh
scripts/build-app.sh   # builds the .app bundle with swift build and signs it
```

Then open the app, enter the web app's URL and choose Sign in with Every App.
