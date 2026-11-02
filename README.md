# Talk

Meeting notes for Every App: a macOS desktop app (Electron, with a native Swift helper for audio) reminds you when a meeting starts, records it (system audio plus the microphone) and transcribes it live with OpenAI; an Every App web app turns the transcript into notes with a template you pick, and keeps them in private and team folders. Notes are private by default, can be shared with the workspace, or published with a revocable link. Audio is never stored.

- `web/`: the Every App app (app id `talk`) and the main window: upcoming meetings, folders, notes, templates, the `/api/v1` the Mac app calls, the shared pages.
- `desktop/`: Talk for Mac, the Electron app: window, tray, sign-in, reminders, call prompts, updates (`desktop/README.md`).
- `mac/`: the Swift package for `talk-helper`, the headless audio capture and transcription process the desktop app runs (`mac/README.md`).
- `packages/ui`: components shared by `web/` and `desktop/`.
- `docs/SPEC.md`: the architecture, data model, API, web app, folders, templates, reminders, sign-in, sharing and permissions. `TODO.md` holds the decisions and open questions.

## Run it locally

Web, from `web/`:

```sh
pnpm install
pnpm dev          # http://talk.localhost:8787, signed in as a test user
pnpm test
```

Desktop, from the repo root and `desktop/`:

```sh
pnpm install
pnpm -C desktop dev            # the Electron app, with a fake helper
pnpm -C desktop package:local  # "Talk Dev" with the real helper, signed locally and installed
```

Swift helper, from `mac/`: `./scripts/test.sh`, `./scripts/build-helper.sh`. Releases: `docs/release.md`.

The old SwiftUI menu-bar app is retired. An installed `~/Applications/Talk.app` from it is left on disk; delete it by hand.
