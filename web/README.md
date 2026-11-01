# Talk web

The Every App side of Talk: a private web app on Cloudflare behind your Gateway. It holds meetings, transcripts, notes, folders, templates and share links in D1, serves the API the Mac app calls (`/api/v1`, see `../docs/SPEC.md`), and is Talk's main window: a sidebar of folders, the coming week's meetings, the notes.

- `everyapp.config.ts`: the manifest. OpenAI through the Gateway (plus the Realtime client-secret route the operator allows with `AI_PROXY_EXTRA_ROUTES`), Google Calendar through the Gateway's `google-workspace` client (`calendar.read`), one public route for shared pages.
- `src/server/`: the queries (`meetings.ts`, `folders.ts`, `templates.ts`, who sees what in `access.ts`), Google Calendar (`calendar.ts`), the Realtime token (`transcription.ts`), the notes writer (`notes.ts`), the API helpers (`api.ts`).
- `src/routes/api/v1/`: the Mac app's routes. `src/routes/_app/`: the pages behind the sidebar (`_app.tsx`). `src/tools.ts`: the same queries as AI tools.
- `src/client/components/ui/`: the component library copied from OpenCRM/OpenSEO (shadcn on Base UI); `src/styles/app.css` is their theme. Add a component with `pnpm dlx shadcn add <name>` or copy it from them.

## Run it

```sh
pnpm install
pnpm dev          # http://talk.localhost:8787, signed in as a test user
pnpm test
pnpm types:check
```

Add `OPENAI_API_KEY=…` to `.dev.vars` to mint transcription tokens and write notes locally; `GOOGLE_WORKSPACE_ACCESS_TOKEN=…` stands in for a Google connection.

## The SDK and CLI are linked to a checkout

For the native sign-in e2e run, `package.json` links `@every-app/sdk` and `everyapp` to `/Users/bensenescu/.t3/worktrees/private-every-app/native-sign-in-e2e` (branch `feature/native-sign-in`). Build them there first (`pnpm install` in that checkout, then `pnpm -C packages/cli build`), then `pnpm install` here. To go back to the published packages, set both to `^0.3.0-rc.8` in `package.json` and run `pnpm install`.

## Put it online

`pnpm run deploy`, then `pnpm everyapp configure talk` for what the Gateway lacks (`OPENAI_API_KEY`, `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`, the Google client).
