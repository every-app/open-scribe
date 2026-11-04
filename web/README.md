# Talk web

The Every App side of Talk: a private web app on Cloudflare behind your Gateway. It holds meetings, transcripts, notes, folders, templates and share links in D1, serves the API the Mac app calls (`/api/v1`, see `../docs/SPEC.md`), and is Talk's main window: a sidebar of folders, the coming week's meetings, the notes.

- `everyapp.config.ts`: the manifest. OpenAI through the Gateway (plus the Realtime client-secret route the operator allows with `AI_PROXY_EXTRA_ROUTES`), Google Calendar through the Gateway's `google-workspace` client (`calendar.readonly`, an optional feature), one public route for shared pages and the desktop app's bearer route (`/api/v1/**`).
- `src/server/`: the queries (`meetings.ts`, `folders.ts`, `templates.ts`, `settings.ts`, who sees what in `access.ts`), Google Calendar (`calendar.ts`), the Realtime token (`transcription.ts`), the notes writer (`notes.ts`, its prompt in `notesPrompt.ts`), the API helpers (`api.ts`).
- `src/api/contract.ts`: the `/api/v1` contract, every request schema (zod) and response type, importing nothing but zod so the desktop app can import or copy it. The server modules and routes take their schemas and types from it.
- `src/routes/api/v1/`: the API the Mac helper and the desktop window call. `src/routes/_app/`: the pages behind the sidebar (`_app.tsx`). `src/tools.ts`: the same queries as AI tools.
- The component library (shadcn on Base UI, from OpenCRM/OpenSEO), the theme, `theme.ts` and `dates.ts` are `../packages/ui`'s, shared with the desktop app: import `@talk/ui/components/<name>`, `@talk/ui/lib/theme`, `@talk/ui/lib/dates`. `src/styles/app.css` imports `@talk/ui/styles.css` and tells Tailwind to scan the shared components. Add a component in `packages/ui/src/components/ui` by copying it from OpenCRM/OpenSEO (web no longer has a shadcn `components.json`: `shadcn add` here would bring the copies back).
- `@talk/ui` is a `file:../packages/ui` dependency, not a workspace link: web keeps its own lockfile and stays out of the root workspace. pnpm hard-links the package's files, so edits in `packages/ui` show up at once; if an editor breaks the links (or `packages/ui/package.json` changes), run `pnpm install` here again.

## Run it

```sh
pnpm install
pnpm dev          # http://talk.localhost:8787, signed in as a test user
pnpm test
pnpm types:check
```

### Sample data

`pnpm seed` fills the **local** database `pnpm dev` uses (it applies the migrations first, and only ever runs `everyapp db query --local`) with nine meetings over the last two weeks: transcripts, notes (one edited), jottings, a live recording, a failed one, a teammate's shared meeting, a public link, private and team folders and two custom templates. They belong to the dev identities in `dev-org`: the owner `dev-user` (dev@everyapp.localhost, what any bearer and the browser act as) and a member `dev-member` (`pnpm everyapp dev token --role member`, sent as `x-everyapp-identity` to the app port `pnpm dev` prints). Rerunning replaces the seeded rows (ids start with `5eed`) and leaves the rest. `pnpm seed --print` shows the SQL. Other identities: `SEED_ORG`, `SEED_USER`, `SEED_MEMBER` (and `…_EMAIL`).

```sh
pnpm seed
pnpm dev
curl -H "authorization: Bearer dev" "http://talk.localhost:8787/api/v1/meetings?limit=5"
```

Add `OPENAI_API_KEY=…` to `.dev.vars` to mint transcription tokens and write notes locally; `GOOGLE_WORKSPACE_ACCESS_TOKEN=…` stands in for a Google connection.

## The SDK and CLI are linked to a checkout

For the native sign-in e2e run, `package.json` links `@every-app/sdk` and `everyapp` to `/Users/bensenescu/.t3/worktrees/private-every-app/native-sign-in-e2e` (branch `feature/native-sign-in`). Build them there first (`pnpm install` in that checkout, then `pnpm -C packages/cli build`), then `pnpm install` here. To go back to the published packages, set both to `^0.3.0-rc.8` in `package.json` and run `pnpm install`.

## The desktop update feed

The desktop app updates from `https://talk.<base>/api/v1/updates/mac` (electron-updater's generic provider; `TALK_UPDATE_URL` in `desktop/electron-builder.config.cjs`), sending the member's bearer token. The route (`src/routes/api/v1/updates.mac.$file.ts`, rules in `src/server/updates.ts`) streams `mac/<file>` from the `UPDATES` R2 bucket, which `pnpm run deploy` creates from `resources.r2` in the manifest. It serves only `latest-mac.yml` and `Talk-<version>[-…].zip`, `.dmg` and their `.blockmap`s.

Publish a release by uploading electron-builder's output from `desktop/dist/` under `mac/`, **`latest-mac.yml` last**, so no client reads a feed that names a file not uploaded yet. The bucket is the one the deploy made for `UPDATES` (locally `every-talk--updates`; check its deployed name under R2 in the Cloudflare dashboard after the first deploy). Wrangler takes objects up to 300 MB:

```sh
BUCKET=every-talk--updates   # the deployed bucket's name
V=1.2.3
for f in Talk-$V-arm64-mac.zip Talk-$V-arm64-mac.zip.blockmap Talk-$V-arm64.dmg Talk-$V-arm64.dmg.blockmap; do
  npx wrangler@4 r2 object put "$BUCKET/mac/$f" --file "../desktop/dist/$f" --remote
done
npx wrangler@4 r2 object put "$BUCKET/mac/latest-mac.yml" --file ../desktop/dist/latest-mac.yml --content-type text/yaml --remote
```

Release files are cached as immutable, so never re-upload a different file under a name that was published: bump the version. To try the feed against `pnpm dev`, put the objects into the local bucket instead (`--local --persist-to .cloudflare/state` in place of `--remote`; not tried yet, so check the dev state directory if the route answers 404).

## Put it online

`pnpm run deploy`, then `pnpm everyapp configure talk` for what the Gateway lacks (`OPENAI_API_KEY`, `AI_PROXY_EXTRA_ROUTES=/v1/realtime/client_secrets`, the Google client).
