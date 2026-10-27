import Foundation
import OpenZenCore

/// The fallback when the Worker can't mint Realtime keys (`APIError.isRealtimeUnavailable`):
/// chunks of up to 30 s, cut at turn ends, go to `POST …/audio-chunk` as in-memory WAVs; the
/// Worker passes each to OpenAI's transcription endpoint, stores the segment and drops the audio.
actor ChunkChannel: SpeakerChannel {
  static let maxAttempts = 3

  let speaker: Speaker
  let language: String?
  let upload: @Sendable (_ wav: Data, _ seq: Int, _ t0: Int, _ t1: Int) async throws -> Segment?
  let seq: SeqCounter
  let onLive: @Sendable (Speaker, String) -> Void
  let onProblem: @Sendable (Speaker, String?) -> Void

  private var cutter = ChunkCutter()
  private var queue: Task<Void, Never>?
  private var stopped = false

  init(
    speaker: Speaker, language: String?, seq: SeqCounter,
    upload: @escaping @Sendable (_ wav: Data, _ seq: Int, _ t0: Int, _ t1: Int) async throws -> Segment?,
    onLive: @escaping @Sendable (Speaker, String) -> Void,
    onProblem: @escaping @Sendable (Speaker, String?) -> Void
  ) {
    self.speaker = speaker
    self.language = language
    self.seq = seq
    self.upload = upload
    self.onLive = onLive
    self.onProblem = onProblem
  }

  func start() async throws {}

  func feed(_ pcm: Data) async {
    guard !stopped else { return }
    for chunk in cutter.feed(pcm) { send(chunk) }
  }

  func finish() async {
    guard !stopped else { return }
    stopped = true
    if let chunk = cutter.finish() { send(chunk) }
    await queue?.value
  }

  func cancel() async {
    stopped = true
    queue?.cancel()
    cutter = ChunkCutter()
  }

  /// Uploads in order, one at a time, so the Worker sees seqs ascending.
  private func send(_ chunk: ChunkCutter.Chunk) {
    let wav = WAV.encode(pcm16: chunk.pcm)
    let (t0, t1) = (chunk.startedMs, chunk.endedMs)
    let number = seq.next()
    let previous = queue
    let speaker = self.speaker
    queue = Task { [upload, onLive, onProblem] in
      await previous?.value
      for attempt in 1...Self.maxAttempts {
        guard !Task.isCancelled else { return }
        do {
          if let segment = try await upload(wav, number, t0, t1) { onLive(speaker, segment.text) }
          onProblem(speaker, nil)
          return
        } catch {
          // A bad, oversized or refused chunk (4xx) fails the same way every time.
          let permanent: Bool = {
            if case APIError.server(let status, _, _) = error { return (400..<500).contains(status) && status != 429 }
            return error is APIError
          }()
          if permanent || attempt == Self.maxAttempts {
            onProblem(speaker, "A stretch of audio couldn't be transcribed: \(error.localizedDescription)")
            return
          } else {
            try? await Task.sleep(for: .seconds(Double(attempt * 2)))
          }
        }
      }
    }
  }
}

/// Segment numbers shared by both speakers of one meeting.
final class SeqCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func next() -> Int {
    lock.withLock {
      defer { value += 1 }
      return value
    }
  }
}
