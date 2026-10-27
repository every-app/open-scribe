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

## Put it online

`pnpm run deploy`, then `pnpm everyapp configure open-zen` for what the Gateway lacks (`OPENAI_API_KEY`, `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`, the Google client).
