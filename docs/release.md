# Releasing Talk for Mac

One command builds, signs, notarizes and verifies a release, then prints the upload commands. **It never uploads anything itself.**

```sh
scripts/release-mac.sh --release --bump patch     # or minor / major / 1.2.3
```

## Once: set up signing (about 20 minutes)

Keep all of this in your login Keychain and shell, **never in the repo**.

| What | How | Ends up |
| --- | --- | --- |
| **Developer ID Application certificate** | developer.apple.com → Certificates → "+" → Developer ID Application (G2 Sub-CA). Make the CSR with Keychain Access → Certificate Assistant, then double-click the downloaded `.cer`. | Login Keychain. Check it with `security find-identity -v -p codesigning`, which should show `Developer ID Application: Ben Senescu (TEAMID)`. |
| **App Store Connect API key** (for notarytool) | appstoreconnect.apple.com → Users and Access → Integrations → Team Keys → "+", role *Developer*. Download the `.p8` (you only get one chance) and note the Key ID and Issuer ID. | `~/.private_keys/AuthKey_<KEYID>.p8`, mode 0600 |
| **Env for the release shell** | Put it in `~/.talk-release.env` (0600, outside the repo) and `source` it before releasing. | See below |

```sh
# ~/.talk-release.env (chmod 600)
export APPLE_API_KEY=~/.private_keys/AuthKey_ABC123XYZ.p8   # path to the .p8
export APPLE_API_KEY_ID=ABC123XYZ
export APPLE_API_ISSUER=00000000-0000-0000-0000-000000000000
export TALK_UPDATE_URL=https://talk.<base>/api/v1/updates/mac   # see "Update feed"
export TALK_UPDATE_BUCKET=<the UPDATES bucket's name>            # for the printed upload commands
# Only if the keychain holds more than one Developer ID:
# export TALK_SIGN_ID="Developer ID Application: Ben Senescu (TEAMID)"
```

The fallback for notarization is `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com) + `APPLE_TEAM_ID`. The API key is better: it isn't tied to your Apple ID password or 2FA.

## Cut a release

1. Start from an up-to-date `main` with a clean tree and run `pnpm install`.
2. Run `source ~/.talk-release.env`.
3. **Dry run first** (the default). It builds, signs, notarizes and verifies, but doesn't change git:
   ```sh
   scripts/release-mac.sh --bump patch
   ```
4. **Real run.** This bumps `desktop/package.json`, commits it, tags `talk-v<version>`, builds and verifies:
   ```sh
   scripts/release-mac.sh --release --bump patch
   ```
   If you already tagged HEAD as `talk-v<version>`, leave out `--bump`.
5. The output lands in `dist/release/<version>/`: the DMG, the zip, `latest-mac.yml`, blockmaps and `SHA256SUMS`.
6. The script prints the upload commands. Run the ones for your feed, **with `latest-mac.yml` last**, then push the tag:
   ```sh
   git push origin main talk-v<version>
   ```

What the script checks before building:
- a Developer ID identity;
- notarization credentials;
- a clean tree;
- the tag (or `--bump`);
- `TALK_UPDATE_URL`;
- that the output folder doesn't already exist.

It lists everything missing and stops. In a dry run, the tree, tag and feed checks only warn.

What it verifies after building:
- `codesign --verify --deep --strict`;
- `spctl -a -vvv -t exec` on the app and `spctl -a -vvv -t install` on the DMG;
- `xcrun stapler validate` on the app, the app inside the zip, and the DMG;
- the helper is universal and signed as `com.everyapp.talk.helper`;
- the version and mic/audio usage strings in Info.plist;
- `latest-mac.yml` matches the zip.

electron-builder notarizes the app; the script then notarizes and staples the DMG.

**No credentials yet?** `scripts/release-mac.sh --dry-run --unsigned` runs the same pipeline with ad hoc signatures and no notarization. The files are *not* shippable.

## Check the hardware (1 minute, before handing out the alpha)

On the Mac that will run the release, with no account and no network needed:

```sh
"/Applications/Talk.app/Contents/MacOS/talk-helper" --selftest --seconds 15
```

While it runs, play a YouTube video through the speakers (not headphones) and talk. Expect `mic: OK`, `system audio: OK`, no clipping, no dropouts, and `PASS`. `DENIED` on system audio means nothing was playing or System Settings → Privacy & Security → System Audio Recording is off for the app that ran it (the terminal here; Talk itself when it's run from Settings). Add `--echo-cancellation` to try voice processing; it should say `voice processing on`, and the video should still be at full volume.

## Update feed

electron-updater reads `latest-mac.yml` from the feed and installs from the zip. The feed URL is baked into the app at build time from `TALK_UPDATE_URL`. If it's unset, the app has no updater. **Pick the feed before the first release**, because changing it later means one manual reinstall.

| Option | How | Trade-offs |
| --- | --- | --- |
| **A. Private R2 bucket behind the Gateway** (recommended) | The R2 bucket bound to the Talk Worker as `UPDATES` (the deploy creates it; find its name in the Cloudflare dashboard; locally `every-talk--updates`). `GET`/`HEAD /api/v1/updates/mac/:file` serves `mac/<file>` to any signed-in member; the app sends its bearer (refreshed before each check). `TALK_UPDATE_URL=https://talk.<base>/api/v1/updates/mac` | Only signed-in org members can download. Same auth as the rest of the app. No new credentials. Shipped: the Worker route in #24, the updater's bearer (own origin only) in #23. |
| A′. Public R2 bucket, unguessable path (only until the private route is deployed) | `r2.dev` or a custom domain, path `/talk/<random>/mac/` | Works today with no code changes. Anyone with the URL can download. |
| B. GitHub Releases | `gh release create …` (the script prints it). The `github` provider in electron-builder. | `every-app/private-talk` is private, so the app would need a GitHub token to read releases. That token would be shipped in every copy or handed out per user, and it can read the repo. **Not recommended** unless the releases move to a public repo. |

Uploads (the script prints them, with `$TALK_UPDATE_BUCKET` filled in):

```sh
npx wrangler@4 r2 object put "$BUCKET/mac/<file>" --file dist/release/<version>/<file> --remote      # each zip, dmg, blockmap
npx wrangler@4 r2 object put "$BUCKET/mac/latest-mac.yml" --file dist/release/<version>/latest-mac.yml --content-type text/yaml --remote   # last
```

- **`latest-mac.yml` goes last**, so no client ever sees a feed naming a file that isn't there yet.
- **Never re-upload a different file under a published name.** Release files are served `immutable` for a year; bump the version instead. `latest-mac.yml` is `no-cache`.
- The route serves only `latest-mac.yml` and `Talk-<x.y.z>[-…].zip` / `.dmg` / `.blockmap` (what the script makes, e.g. `Talk-1.2.3-universal-mac.zip`); anything else is a 404. Range requests work, so blockmap differential downloads do.

## Check that an update keeps the sign-in (alpha checklist)

The sign-in is encrypted with a key in the login Keychain. Under a Developer ID, its partition is your **Team ID**, so any build you sign can read it. Self-signed and ad hoc builds can't, which is why dev rebuilds sign you out.

1. Release **N** (for example 0.1.0), install it from the DMG on a test account, sign in, and record a short meeting.
2. Release **N+1** with the same identity and upload it.
3. Wait for the check (at launch, then every 6 h), or quit and reopen. The app downloads N+1 and installs it on quit.
4. Reopen. It should still be signed in with no Keychain prompt, show version N+1 in Settings, and still have its mic and system-audio grants.
5. If it asks you to sign in again, the two builds weren't signed by the same Team ID. Compare `codesign -dv --verbose=2 /Applications/Talk.app 2>&1 | grep TeamIdentifier` across versions.

## Rollback

- **Stop a bad release from spreading:** upload the previous version's `latest-mac.yml` again, leaving its files where they are. Copies that haven't updated yet stay put.
- **Copies that already updated** don't downgrade by themselves (electron-updater only moves forward). Ship a fix as N+2. If that can't wait, have people reinstall the old DMG from `dist/release/<old>/` or the bucket.
- Keep every `dist/release/<version>/` folder (or the bucket's copies). The tags record what was built.
