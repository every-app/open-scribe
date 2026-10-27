# OpenZen orchestration log

The orchestrator is thread mcp:404aa580-ddb5-41b7-ba61-a5540bfdbe7b. Times are UTC.

## Threads

| Lane | Thread | Model | Where | Owns |
| --- | --- | --- | --- | --- |
| Spec + web | mcp:b25b41f1-6aac-472f-8718-e9836ca1d96c | Fable | open-notes root | `web/`, `docs/SPEC.md` |
| Mac app | mcp:dfbe9056-bf89-4b0e-8227-4438c318615e | Opus | open-notes root | `mac/` |
| Native sign-in design | mcp:0132ffd3-8144-4596-b817-ea6a5ad0a107 | Fable | private-every-app, `native-sign-in/design` | design note, threat model, TODO section |

## Log

- 01:07 Took over from the launch orchestrator (4b2ee96d). Read the spec thread; SPEC.md v1 committed (283b7ed).
- 01:10 Created `feature/native-sign-in` on origin from origin/main (aea159ca1).
- 01:11 Launched the native sign-in design thread (Fable).
- 01:12 Re-briefed the spec thread: rename to OpenZen, own web/ only, build web/ all the way.
- 01:13 Launched the OpenZen mac thread (Opus).
- 01:14 Scheduled a 25-minute check-in.
- 01:20 Launch orchestrator forwarded the spec thread's Step 1 answers; filed Q1–Q9 as decided (app id `open-zen`, Access on). Sent the decisions to the spec, mac and design threads.
- 01:40 Web lane done (6fe27ea): created with the published CLI 0.3.0-rc.8; D1, the full /api/v1, web UI and share links verified with `everyapp dev` in stub mode; 5 tests pass. Asked it for the audio-chunk fallback route.
- 01:50 SPEC sign-in section rewritten for Sign in with Every App (3d53f6d), with eight platform asks; forwarded them to the design thread.
- 02:00 Web: audio-chunk fallback route committed (gpt-4o-mini-transcribe). Web lane idle.
