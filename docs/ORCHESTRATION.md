# OpenZen orchestration log

The orchestrator is thread mcp:404aa580-ddb5-41b7-ba61-a5540bfdbe7b. Times are UTC (2026-10-27).

## Threads

| Lane | Thread | Model | Where | Owns |
| --- | --- | --- | --- | --- |
| Spec + web | mcp:b25b41f1-6aac-472f-8718-e9836ca1d96c | Fable | open-notes root | `web/`, `docs/SPEC.md` |
| Mac app | mcp:dfbe9056-bf89-4b0e-8227-4438c318615e | Opus | open-notes root | `mac/` |
| Native sign-in design | mcp:0132ffd3-8144-4596-b817-ea6a5ad0a107 | Fable | private-every-app, `native-sign-in/design` | design note, threat model, TODO section (done, #854) |
| Lane a: Gateway auth server | mcp:f9f1c5de-40fd-491d-976e-30d975ddba4a | Fable | `native-sign-in/a-gateway-as` | mcp-auth/*, mcp schema + migration, connection repo/service |
| Lane b: perimeter/SDK | mcp:bb842312-e66c-4ce6-9245-e94511884f2a | Fable | `native-sign-in/b-perimeter` | perimeter, manifest `bearerRoutes`, RFC 9728 metadata, everyapp dev |
| Lane c: Gateway UI | mcp:4ddbe96b-faaa-4889-a31b-52a14cfea9a2 | Opus | `native-sign-in/c-ui` | consent.tsx, connections.tsx |
| Lane d: docs + CLI | mcp:3444b6ca-8d64-4035-a3c8-a37c272ebcb4 | Opus | `native-sign-in/d-docs-cli` | agent docs, runbooks, security-model, cli access plan |

## Log

- 01:07 Took over from the launch orchestrator (4b2ee96d). Read the spec thread; SPEC.md v1 committed (283b7ed).
- 01:08 Created `feature/native-sign-in` on origin from origin/main (aea159ca1).
- 01:08 Launched the native sign-in design thread (Fable).
- 01:08 Re-briefed the spec thread: rename to OpenZen, own web/ only, build web/ all the way.
- 01:08 Launched the OpenZen mac thread (Opus).
- 01:08 Scheduled a 25-minute check-in.
- 01:09 Launch orchestrator forwarded the spec thread's Step 1 answers; filed Q1–Q9 as decided (app id `open-zen`, Access on). Sent the decisions to the spec, mac and design threads.
- 01:18 Web lane done (6fe27ea): created with the published CLI 0.3.0-rc.8; D1, the full /api/v1, web UI and share links verified with `everyapp dev` in stub mode; 5 tests pass. Asked it for the audio-chunk fallback route.
- 01:19 SPEC sign-in section rewritten for Sign in with Every App (3d53f6d), with eight platform asks; forwarded them to the design thread.
- 01:21 Web: audio-chunk fallback route committed (gpt-4o-mini-transcribe). Web lane idle.
- 01:23 Design merged into feature/native-sign-in (#854). Umbrella draft PR #855 → main (never ready). Design: docs/design/native-sign-in.md on the branch.
- 01:23 Sent the client contract (§12) to the mac thread, and the `bearerRoutes` TODO to the web thread.
- 01:25 Launched sign-in lanes a (Fable), b (Fable), c (Opus) and d (Opus) in parallel; a merges first. Sent each the sibling roster.
- 01:25 Web: audio-chunk format agreed with mac; (meeting, seq) unique (7ba6a5a); 7 tests pass. `everyapp dev` left running at http://open-zen.localhost:8787. Web lane idle.
- 01:26 Design follow-up #856: works behind Access through `bearerRoutes` path bypasses (cookies are 401 there); groups become a question for Ben. Asked web to confirm the UI never uses /api/v1 with cookies.
- 01:35 Tick: mac app committed (86a5d0f). It builds and 61 tests pass, and its API client was smoke-tested against local `everyapp dev`. Lanes a–d and the design follow-up are running; nobody is stuck.
- 01:40 Mac report: builds, installs ~/Applications/OpenZen.app and runs; 61 tests; API smoke test against dev passes. Untested: capture, TCC, Realtime, notifications, sign-in end to end. Two items differ from the sign-in contract (scope `app:open-zen`, a new client per sign-in); the contract message is queued for it.
- 01:45 Design §13 (#857) answers OpenZen's eight asks: binding is by resource, not scope; the user types the app URL; `bearerRoutes` is an object; `everyapp dev` mirror mode is deferred. Sent the deltas to mac, web (SPEC) and lanes a, b and d. Consequence: the end-to-end run needs a Gateway deployed from the feature branch on the loop-1 test account, not local.
- 01:50 SPEC aligned with design §13 (1e74eb8). #857 (§13) isn't on the feature branch yet; check it merges. Web idle.
- 01:55 Mac b35ecc7: Access login detection, chunked fallback (ChunkCutter); 71 tests. Still to apply from the queue: no scope, register once, user types the app URL.
- 02:10 Tick: the Mac slept from about 01:55 to 02:09, and lane b's turn died. Nudged a and b to resume. c renders the consent page in local dev; d's #858 is open and held for a and b; the design thread is done. a and b have no PRs yet.
- 02:11 Started `caffeinate -is -t 21600` (6 h) so idle sleep stops killing turns. Stop it with `pkill caffeinate`.
- 02:15 Lane d: #858 rebased on #857 and green, now on the object `bearerRoutes`; steered lane b, which still has string[] in its worktree.
- 02:20 Lane c: #859 open (consent app variant, Apps on your devices; 15 tests), held for lane a. Contract sent to a.
- 02:25 Mac 61d401f/6fcda5d: device-change restarts, launch at login; 73 tests. Sign-in corrections still unapplied (scope, per-sign-in registration, no RFC 9728), so I steered it.
- 02:35 Mac 3f6b0cf: sign-in now matches design §12/§13 (RFC 9728 discovery, no scope, register once, invalid_client re-register); 83 tests. 38ed78a: no retry on a 4xx chunk. Mac waits for the end-to-end run.
- 02:40 Mac 0450c4b: the client checks the echoed token `resource`; 86 tests. All ten contract items are built. Mac idle until the end-to-end run.
