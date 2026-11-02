import Foundation
import Testing
import TalkCore
@testable import TalkRecording

/// Realtime outages: the audio kept while a speaker's connection was down is replayed through
/// the chunk fallback with seqs that slot in by time, `state.transcription` goes
/// reconnecting → catching_up → live, and stop finishes the replay before `/finish`.
@Suite @MainActor struct OutageReplayTests {
  static let start = #"{"id":1,"cmd":"record.start","params":{"meetingId":"m1","apiBase":"https://t.example.com","accessToken":"t"}}"#

  /// `ms` of a tone (speech to the turn detector), then `silenceMs` of silence.
  static func speech(_ ms: Int, silenceMs: Int = 1_000) -> Data {
    PCM16.encode((0..<(ms * 24)).map { sin(Float($0) / 10) * 0.2 } + [Float](repeating: 0, count: silenceMs * 24))
  }

  final class Fixture {
    let rig = FakeRig()
    let out = Output()
    let worker: FakeWorker
    let server: HelperServer

    @MainActor init(worker: FakeWorker = .happy(), replayText: [Speaker: String] = [:], clock: ManualClock? = nil, failReplay: Bool = false) {
      self.worker = worker
      worker.audioChunk = { fields in
        if failReplay { return (503, #"{"error":"unavailable"}"#) }
        let speaker = Speaker(rawValue: fields["speaker"] ?? "") ?? .me
        let text = replayText[speaker] ?? "\(speaker.rawValue) during the outage"
        return (201, #"{"segment":{"seq":\#(fields["seq"]!),"startedMs":\#(fields["startedMs"]!),"endedMs":\#(fields["endedMs"]!),"speaker":"\#(speaker.rawValue)","text":"\#(text)"}}"#)
      }
      var env = environment(worker: worker, rig: rig)
      var fast = ChunkChannel.Limits()
      fast.retryBase = .milliseconds(1)
      env.pipeline.makeReplay = { ChunkChannel(speaker: $0, language: $1, offsetMs: $2, seqFor: $3, upload: $4, callbacks: $5, limits: fast) }
      if let clock {
        env.pipeline.echoHoldMs = 4_000
        env.pipeline.now = { clock.now }
        env.pipeline.levelInterval = .milliseconds(5)
      }
      let out = self.out
      server = HelperServer(environment: env, write: { out.write($0) })
    }

    func transcriptionStates() -> [String] {
      var seen: [String] = []
      for s in out.events("state") { if let t = s["transcription"]?.string, seen.last != t { seen.append(t) } }
      return seen
    }

    func posted() throws -> [Segment] {
      try worker.requests.filter { $0.url!.path.hasSuffix("/segments") }.flatMap { try JSONDecoder().decode([Segment].self, from: $0.httpBody!) }
    }
  }

  @Test func anOutageIsReplayedAndSlotsInByTime() async throws {
    let f = Fixture()
    await f.server.handle(Self.start)
    let me = try #require(f.rig.channel(.me))
    await me.report("The connection to OpenAI dropped")
    #expect(await f.out.waitFor { f.transcriptionStates().last == "reconnecting" })

    // The other side goes on live meanwhile.
    f.rig.system?.speak()
    // Back after 5 s down, from 5 s into the meeting: 3 s of speech kept.
    await me.reconnect(outage: Self.speech(3_000), startedAt: 5_000)
    #expect(await f.out.waitFor { f.transcriptionStates() == ["live", "reconnecting", "catching_up", "live"] })

    let chunks = f.worker.requests.filter { $0.url!.path.hasSuffix("/audio-chunk") }
    let chunk = try #require(chunks.first)
    let fields = FakeWorker.multipartFields(chunk.httpBody)
    #expect(fields["speaker"] == "me")
    #expect(fields["startedMs"] == "5000")
    #expect(fields["seq"] == "\(TranscriptSeq.make(startedMs: 5_000, speaker: .me, replay: true))")
    let replayedEvents = f.out.events("transcript.segment").filter { $0["text"] == "me during the outage" }
    let replayed = try #require(replayedEvents.first)
    #expect(replayed["seq"] == .int(20_001))

    await f.server.handle(#"{"id":2,"cmd":"record.stop"}"#)
    // Live `them` (posted) + the replayed chunk (stored by /audio-chunk).
    #expect(f.out.response(2)?["result"] == ["segments": 2, "finished": true])
    #expect(f.worker.paths().last == "/api/v1/meetings/m1/finish")
  }

  @Test func overflowWarns() async throws {
    let f = Fixture()
    await f.server.handle(Self.start)
    let me = try #require(f.rig.channel(.me))
    // What TranscriptionChannel says when the outage outgrows its 5 minutes (OutageBuffer).
    await me.backlog("The connection was down for over 5 minutes: the oldest audio from the outage was dropped")
    #expect(await f.out.waitFor { f.out.events("error").contains { $0["code"] == "fallback_backlog" && $0["fatal"] == false } })
    await f.server.handle(#"{"id":2,"cmd":"record.stop"}"#)
  }

  @Test func stopDuringCatchUpFinishesTheReplayFirst() async throws {
    let upload = Gate()
    let worker = FakeWorker.happy()
    worker.hold = { path, _ in if path.hasSuffix("/audio-chunk") { await upload.wait() } }
    let f = Fixture(worker: worker)
    await f.server.handle(Self.start)
    let me = try #require(f.rig.channel(.me))
    await me.report("dropped")
    await me.reconnect(outage: Self.speech(2_000), startedAt: 1_000)
    #expect(await f.out.waitFor { upload.arrived == 1 })

    let stop = Task { await f.server.handle(#"{"id":2,"cmd":"record.stop"}"#) }
    for _ in 0..<50 { await Task.yield() }
    // /audio-chunk needs the meeting still recording: /finish waits for the replay.
    #expect(!f.worker.paths().contains("/api/v1/meetings/m1/finish"))
    upload.release()
    await stop.value
    #expect(f.out.response(2)?["result"] == ["segments": 1, "finished": true])
    let order = f.worker.completed.filter { $0.hasSuffix("/audio-chunk") || $0.hasSuffix("/finish") }
    #expect(order == ["/api/v1/meetings/m1/audio-chunk", "/api/v1/meetings/m1/finish"])
  }

  @Test func aReplayThatFailsIsReportedNotHidden() async throws {
    let f = Fixture(failReplay: true)
    await f.server.handle(Self.start)
    let me = try #require(f.rig.channel(.me))
    await me.report("dropped")
    await me.reconnect(outage: Self.speech(2_000), startedAt: 1_000)
    await f.server.handle(#"{"id":2,"cmd":"record.stop"}"#)
    // The audio can't be handed back (it's never kept beyond memory): it's said plainly.
    #expect(f.out.response(2)?["result"] == ["segments": 0, "finished": true])
    #expect(f.out.events("error").contains { $0["code"] == "transcription" && ($0["message"]?.string ?? "").contains("catching up") })
    #expect(f.out.events("error").contains { $0["code"] == "save_failed" && ($0["message"]?.string ?? "").contains("reconnect") })
    #expect(f.worker.requests.filter { $0.url!.path.hasSuffix("/audio-chunk") }.count == ChunkChannel.maxAttempts)
  }

  @Test func myEchoOfTheirOutageIsStillDropped() async throws {
    let said = "we should move the launch to next Tuesday"
    let clock = ManualClock()
    let f = Fixture(replayText: [.them: said], clock: clock)
    f.rig.script = [.me: [said, "I can take that"]]
    await f.server.handle(Self.start)
    let them = try #require(f.rig.channel(.them))
    await them.report("dropped")
    #expect(await f.out.waitFor { f.transcriptionStates().last == "reconnecting" })

    // The mic hears their words (the echo) while their own stream is down.
    f.rig.mic?.speak()
    #expect(await f.out.waitFor { f.server.pipeline?.heldForEcho == 1 })
    clock.advance(by: .seconds(10))  // well past the 4 s hold…
    for _ in 0..<50 { await Task.yield() }
    // …but their side is incomplete, so my segment waits instead of being judged blind.
    #expect(!f.out.events("transcript.segment").contains { $0["speaker"] == "me" })
    #expect(f.server.pipeline?.heldForEcho == 1)

    await them.reconnect(outage: Self.speech(3_000), startedAt: 0)
    #expect(await f.out.waitFor { f.transcriptionStates().last == "live" })
    #expect(await f.out.waitFor { f.server.pipeline?.echoCounts.dropped == 1 })  // judged now: an echo
    f.rig.mic?.speak()  // real words afterwards
    #expect(await f.out.waitFor { f.server.pipeline?.heldForEcho == 1 })
    clock.advance(by: .seconds(5))
    #expect(await f.out.waitFor { f.out.events("transcript.segment").contains { $0["text"] == "I can take that" } })

    await f.server.handle(#"{"id":2,"cmd":"record.stop"}"#)
    let mine = f.out.events("transcript.segment").filter { $0["speaker"] == "me" }.compactMap { $0["text"]?.string }
    #expect(mine == ["I can take that"])
    #expect(try f.posted().map(\.text) == ["I can take that"])
  }
}
