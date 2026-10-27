import Foundation
import OpenZenCore

/// The fallback when the Gateway won't mint Realtime keys (`ai_route_not_allowed`): each turn
/// the detector finds (30 s at most) goes to the Worker as an in-memory WAV, which it passes to
/// OpenAI's transcription endpoint and drops. The Worker stores the segment itself.
actor ChunkChannel: SpeakerChannel {
  static let maxAttempts = 3

  let speaker: Speaker
  let language: String?
  let upload: @Sendable (_ wav: Data, _ seq: Int, _ t0: Int, _ t1: Int) async throws -> Segment?
  let seq: SeqCounter
  let onLive: @Sendable (Speaker, String) -> Void
  let onProblem: @Sendable (Speaker, String?) -> Void

  private var detector = TurnDetector()
  /// Audio since the current turn started.
  private var pending = Data()
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
    pending.append(pcm)
    for action in detector.feed(PCM16.decode(pcm)) {
      switch action {
      case .commit(let t0, let t1): send(t0: t0, t1: t1)
      case .skipSilence: pending.removeAll(keepingCapacity: true)
      }
    }
  }

  func finish() async {
    guard !stopped else { return }
    stopped = true
    if case .commit(let t0, let t1)? = detector.flush() { send(t0: t0, t1: t1) }
    await queue?.value
  }

  func cancel() async {
    stopped = true
    queue?.cancel()
    pending = Data()
  }

  /// Uploads in order, one at a time, so the Worker sees seqs ascending.
  private func send(t0: Int, t1: Int) {
    let wav = WAV.encode(pcm16: pending)
    pending = Data()
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
          if attempt == Self.maxAttempts {
            onProblem(speaker, "A stretch of audio couldn't be transcribed: \(error.localizedDescription)")
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
