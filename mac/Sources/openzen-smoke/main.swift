import Foundation
import OpenZenCore

// `swift run openzen-smoke <app URL> <token>`: drives the Mac app's API client through a whole
// meeting against a running web/ (e.g. `everyapp dev` at http://open-zen.localhost:8787, where
// any bearer is the dev user). No audio: segments are made up. Prints each step.
let args = CommandLine.arguments
guard args.count == 3, let appURL = URL.typed(args[1])?.origin else {
  FileHandle.standardError.write(Data("usage: openzen-smoke <app URL> <token>\n".utf8))
  exit(2)
}
let api = APIClient(auth: AccessTokenAuthProvider(appURL: appURL, token: args[2]))

func step(_ name: String, _ body: () async throws -> String) async -> Bool {
  do {
    print("ok   \(name): \(try await body())")
    return true
  } catch {
    print("FAIL \(name): \(error.localizedDescription) [\(error)]")
    return false
  }
}

var failed = false
failed = !(await step("me") { let me = try await api.me(); return "\(me.email ?? "?") google=\(me.googleConnected)" }) || failed
failed = !(await step("upcoming") {
  let u = try await api.upcoming()
  return "connected=\(u.connected) events=\(u.events.count) connectURL=\(u.connectURL?.absoluteString ?? "nil")"
}) || failed
var meetingID = ""
failed = !(await step("create") {
  meetingID = try await api.createMeeting(title: "Smoke test", startsAt: Date(), calendarEventId: nil).id
  return meetingID
}) || failed
if !meetingID.isEmpty {
  _ = await step("transcription-token (needs OpenAI set up)") {
    let t = try await api.transcriptionToken(meetingID: meetingID, source: "mic", language: "en")
    return "model=\(t.model ?? "?") expires=\(t.expiresAt)"
  }
  var batcher = SegmentBatcher()
  batcher.add(speaker: .me, startedMs: 0, endedMs: 1_200, text: "Let's start with the roadmap.")
  batcher.add(speaker: .them, startedMs: 1_400, endedMs: 3_000, text: "Sounds good, I have two updates.")
  let batch = batcher.takeBatch()
  failed = !(await step("segments") { try await api.appendSegments(meetingID: meetingID, batch); return "\(batch.count) posted" }) || failed
  failed = !(await step("segments again (dedupe)") { try await api.appendSegments(meetingID: meetingID, batch); return "accepted" }) || failed
  failed = !(await step("finish") { try await api.finish(meetingID: meetingID); return "accepted" }) || failed
  failed = !(await step("meetings") {
    let list = try await api.meetings()
    guard let m = list.first(where: { $0.id == meetingID }) else { throw APIError.decoding("new meeting missing from list") }
    return "\(list.count) total; this one \(m.status ?? "?") → \(m.pageURL(appURL: appURL))"
  }) || failed
}
exit(failed ? 1 : 0)
