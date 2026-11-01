# Talk

Meeting notes for Every App: a native macOS menu-bar app records a meeting (system audio plus the microphone), transcribes it live with OpenAI, and an Every App web app turns the transcript into notes. Notes are private by default, can be shared with the workspace, or published with a revocable link. Audio is never stored.

- `web/`: the Every App app (app id `talk`): D1, the `/api/v1` the Mac app calls, the web UI, the shared pages.
- `mac/`: Talk for Mac, a SwiftUI menu-bar app (Swift Package).
- `docs/SPEC.md`: the architecture, data model, API, sign-in, sharing and permissions. `TODO.md` holds the decisions and open questions.

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
