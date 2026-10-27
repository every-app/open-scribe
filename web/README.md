# OpenZen web

The Every App side of OpenZen: a private web app on Cloudflare behind your Gateway. It holds meetings, transcripts, notes and share links in D1, serves the API the Mac app calls (`/api/v1`, see `../docs/SPEC.md`), and shows the notes in a browser.

- `everyapp.config.ts`: the manifest. OpenAI through the Gateway (plus the Realtime client-secret route the operator allows with `AI_PROXY_EXTRA_ROUTES`), Google Calendar through the Gateway's `google-workspace` client (`calendar.read`), one public route for shared pages.
- `src/server/`: the queries (`meetings.ts`), Google Calendar (`calendar.ts`), the Realtime token (`transcription.ts`), the notes writer (`notes.ts`), the API helpers (`api.ts`).
- `src/routes/api/v1/`: the Mac app's routes. `src/routes/`: the pages. `src/tools.ts`: the same queries as AI tools.

## Run it

```sh
pnpm install
pnpm dev          # http://open-zen.localhost:8787, signed in as a test user
pnpm test
pnpm types:check
```

Add `OPENAI_API_KEY=…` to `.dev.vars` to mint transcription tokens and write notes locally; `GOOGLE_WORKSPACE_ACCESS_TOKEN=…` stands in for a Google connection.

## The SDK and CLI are linked to a checkout

For the native sign-in e2e run, `package.json` links `@every-app/sdk` and `everyapp` to `/Users/bensenescu/.t3/worktrees/private-every-app/native-sign-in-e2e` (branch `feature/native-sign-in`). Build them there first (`pnpm install` in that checkout, then `pnpm -C packages/cli build`), then `pnpm install` here. To go back to the published packages, set both to `^0.3.0-rc.8` in `package.json` and run `pnpm install`.

## Put it online

`pnpm run deploy`, then `pnpm everyapp configure open-zen` for what the Gateway lacks (`OPENAI_API_KEY`, `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`, the Google client).
