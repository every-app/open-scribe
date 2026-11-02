import Foundation
import TalkCore

/// A capture source (the mic, or the system audio tap) delivering PCM16 24 kHz mono.
public protocol AudioSource: AnyObject, Sendable {
  func start() throws
  func stop()
}

public enum RecordingMode: String, Sendable, Equatable {
  case realtime, fallback
}

/// How one source sounds: `silent` means no signal at all for a while (a denied tap, a muted
/// device, nothing playing); `error` means capture stopped or never started.
public enum SourceHealth: String, Sendable, Equatable {
  case ok, silent, error
}

public enum RecordingEvent: Sendable, Equatable {
  case mode(RecordingMode)
  /// The text so far of a turn still being transcribed (Realtime only).
  case delta(speaker: Speaker, text: String, itemID: String)
  /// A finished segment with its seq (queued for posting, or already stored by the fallback).
  case segment(Segment)
  case transcriptionProblem(Speaker, String?)
  case captureProblem(Speaker, String?)
  case health(mic: SourceHealth, system: SourceHealth)
  /// 0–1 each, at most 10 Hz.
  case levels(mic: Double, system: Double)
  /// Segments couldn't be posted (they're kept and retried).
  case saveProblem(String)
  /// The fallback dropped queued audio because uploads couldn't keep up.
  case fallbackBacklog(Speaker, String)
}

/// `RecordingPipeline.abort()` was called before capture started.
public struct RecordingAborted: Error, LocalizedError {
  public var errorDescription: String? { "The recording was stopped before it started." }
}

/// One meeting's recording, minus creating the meeting: capture both sides, stream each to its
/// own transcription channel, post finished segments every ten seconds and on stop, then
/// `/finish`. Shared by the SwiftUI app's `Recorder` and `talk-helper`. Audio is never stored.
@MainActor
public final class RecordingPipeline {
  public struct Dependencies: Sendable {
    public var makeMic: @Sendable (_ onAudio: @escaping @Sendable (Data) -> Void, _ onInterrupted: @escaping @Sendable (String?) -> Void) -> any AudioSource
    public var makeSystem: @Sendable (_ onAudio: @escaping @Sendable (Data) -> Void, _ onInterrupted: @escaping @Sendable (String?) -> Void) -> any AudioSource
    public var makeRealtime: @Sendable (
      _ speaker: Speaker, _ language: String?, _ fetchToken: @escaping @Sendable () async throws -> TranscriptionToken,
      _ callbacks: ChannelCallbacks
    ) -> any SpeakerChannel
    public var makeFallback: @Sendable (
      _ speaker: Speaker, _ language: String?, _ seq: SeqCounter,
      _ upload: @escaping @Sendable (Data, Int, Int, Int) async throws -> Segment?, _ callbacks: ChannelCallbacks
    ) -> any SpeakerChannel
    public var flushInterval: TimeInterval = SegmentBatcher.interval
    /// After the channels finish, how long to let the last segments land.
    public var settle: Duration = .milliseconds(300)
    public var finalRetryDelay: Duration = .seconds(2)
    /// No signal at all for this long makes a source `silent`.
    public var silenceAfter: TimeInterval = 5
    public var levelInterval: Duration = .milliseconds(100)

    public init(
      makeMic: @escaping @Sendable (_ onAudio: @escaping @Sendable (Data) -> Void, _ onInterrupted: @escaping @Sendable (String?) -> Void) -> any AudioSource,
      makeSystem: @escaping @Sendable (_ onAudio: @escaping @Sendable (Data) -> Void, _ onInterrupted: @escaping @Sendable (String?) -> Void) -> any AudioSource,
      makeRealtime: @escaping @Sendable (Speaker, String?, @escaping @Sendable () async throws -> TranscriptionToken, ChannelCallbacks) -> any SpeakerChannel,
      makeFallback: @escaping @Sendable (Speaker, String?, SeqCounter, @escaping @Sendable (Data, Int, Int, Int) async throws -> Segment?, ChannelCallbacks) -> any SpeakerChannel
    ) {
      self.makeMic = makeMic
      self.makeSystem = makeSystem
      self.makeRealtime = makeRealtime
      self.makeFallback = makeFallback
    }

    /// The real mic, the Core Audio tap, OpenAI Realtime and the chunk fallback.
    public static var live: Dependencies {
      Dependencies(
        makeMic: { MicCapture(onAudio: $0, onInterrupted: $1) },
        makeSystem: { SystemAudioCapture(onAudio: $0, onInterrupted: $1) },
        makeRealtime: { TranscriptionChannel(speaker: $0, language: $1, fetchToken: $2, callbacks: $3) },
        makeFallback: { ChunkChannel(speaker: $0, language: $1, seq: $2, upload: $3, callbacks: $4) }
      )
    }
  }

  public struct StopResult: Sendable, Equatable {
    /// Segments saved for this meeting while it recorded (posted, or stored by the fallback).
    public var segments: Int
    /// Why `/finish` or the last post failed, if it did.
    public var problem: String?
  }

  public let meetingID: String
  public let language: String?
  public private(set) var mode: RecordingMode = .realtime
  public private(set) var health: (mic: SourceHealth, system: SourceHealth) = (.ok, .ok)

  private let api: APIClient
  private let deps: Dependencies
  private let onEvent: @MainActor (RecordingEvent) -> Void
  private var mic: (any AudioSource)?
  private var system: (any AudioSource)?
  private var channels: [Speaker: any SpeakerChannel] = [:]
  private var pumps: [Task<Void, Never>] = []
  private var continuations: [Speaker: AsyncStream<Data>.Continuation] = [:]
  private var batcher = SegmentBatcher()
  private var flushTask: Task<Void, Never>?
  private var levelTask: Task<Void, Never>?
  private var activeFlush: Task<String?, Never>?
  private var aborted = false
  private var saved = 0
  private var captureProblems: [Speaker: String] = [:]
  private let meters: [Speaker: LevelMeter] = [.me: LevelMeter(), .them: LevelMeter()]
  private var running = false

  /// True once capture has started (and until stop).
  public var isRunning: Bool { running }

  public init(
    meetingID: String, api: APIClient, language: String?, dependencies: Dependencies = .live,
    onEvent: @escaping @MainActor (RecordingEvent) -> Void
  ) {
    self.meetingID = meetingID
    self.api = api
    self.language = language
    self.deps = dependencies
    self.onEvent = onEvent
  }

  /// Gets both keys (or falls back to chunks), then starts the mic and the system tap. Throws if
  /// transcription or the mic can't start; everything is torn down then. A system tap that
  /// won't start isn't fatal: the meeting records your side and says so.
  public func start() async throws {
    precondition(!running, "start once")
    do {
      try await startCapture()
    } catch {
      await teardown()
      throw error
    }
    running = true
    flushTask = Task { [weak self, deps] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(deps.flushInterval))
        guard !Task.isCancelled else { return }
        await self?.flush()
      }
    }
    levelTask = Task { [weak self, deps] in
      while !Task.isCancelled {
        try? await Task.sleep(for: deps.levelInterval)
        guard !Task.isCancelled else { return }
        self?.tickLevels()
      }
    }
  }

  /// Stops the audio, lets each channel finish its last turn, posts what's left and finishes
  /// the meeting.
  public func stop() async -> StopResult {
    guard running else { return StopResult(segments: saved, problem: nil) }
    running = false
    flushTask?.cancel()
    flushTask = nil
    levelTask?.cancel()
    levelTask = nil
    mic?.stop()
    system?.stop()
    for continuation in continuations.values { continuation.finish() }
    for pump in pumps { await pump.value }
    let open = Array(channels.values)
    await withTaskGroup(of: Void.self) { group in
      for channel in open { group.addTask { await channel.finish() } }
    }
    // Segments reach the batcher through main-actor tasks; let the last ones land.
    try? await Task.sleep(for: deps.settle)
    var problem = await flush(final: true)
    do {
      try await api.finish(meetingID: meetingID)
    } catch {
      problem = problem ?? "The recording stopped, but Talk couldn't be told to write notes: \(error.localizedDescription)"
    }
    await teardown()
    return StopResult(segments: saved, problem: problem)
  }

  /// Stop a `start()` that's still getting keys: it throws `RecordingAborted` instead of
  /// starting capture. No effect once capture has started (use `stop()`).
  public func abort() {
    aborted = true
  }

  /// Drops everything without posting or finishing.
  public func cancel() async {
    running = false
    await teardown()
  }

  // MARK: Private

  private func callbacks() -> ChannelCallbacks {
    ChannelCallbacks(
      segment: { [weak self] speaker, t0, t1, text in
        Task { @MainActor in self?.add(speaker: speaker, t0: t0, t1: t1, text: text) }
      },
      stored: { [weak self] segment in
        Task { @MainActor in
          self?.saved += 1
          self?.onEvent(.segment(segment))
        }
      },
      delta: { [weak self] speaker, text, itemID in
        Task { @MainActor in self?.onEvent(.delta(speaker: speaker, text: text, itemID: itemID)) }
      },
      problem: { [weak self] speaker, problem in
        Task { @MainActor in self?.onEvent(.transcriptionProblem(speaker, problem)) }
      },
      backlog: { [weak self] speaker, message in
        Task { @MainActor in self?.onEvent(.fallbackBacklog(speaker, message)) }
      })
  }

  private func add(speaker: Speaker, t0: Int, t1: Int, text: String) {
    guard let segment = batcher.add(speaker: speaker, startedMs: t0, endedMs: t1, text: text) else { return }
    onEvent(.segment(segment))
  }

  private func startCapture() async throws {
    let api = self.api
    let meetingID = self.meetingID
    let language = self.language
    let callbacks = callbacks()
    for speaker in [Speaker.me, .them] {
      channels[speaker] = deps.makeRealtime(
        speaker, language,
        { try await api.transcriptionToken(meetingID: meetingID, source: speaker == .me ? "mic" : "system", language: language) },
        callbacks)
    }
    // Both keys first: if the Worker can't mint them, decide before touching audio.
    do {
      try await startChannels()
      onEvent(.mode(.realtime))
    } catch let error as APIError where error.isRealtimeUnavailable {
      // No live keys: send 30 s chunks to the Worker instead (SPEC "Fallback").
      for channel in channels.values { await channel.cancel() }
      let seq = SeqCounter()
      for speaker in [Speaker.me, .them] {
        channels[speaker] = deps.makeFallback(
          speaker, language, seq,
          { wav, number, t0, t1 in
            try await api.appendAudioChunk(
              meetingID: meetingID, wav: wav, seq: number, startedMs: t0, endedMs: t1, speaker: speaker, language: language)
          }, callbacks)
      }
      try await startChannels()
      mode = .fallback
      onEvent(.mode(.fallback))
    }
    // Stopped while the keys were being fetched: don't touch audio.
    if aborted { throw RecordingAborted() }
    for speaker in [Speaker.me, .them] {
      let channel = channels[speaker]!
      // Ordered delivery from the audio thread to the channel.
      let (stream, continuation) = AsyncStream<Data>.makeStream(bufferingPolicy: .bufferingNewest(600))
      continuations[speaker] = continuation
      pumps.append(Task.detached { for await chunk in stream { await channel.feed(chunk) } })
    }

    let micSink = continuations[.me]!
    let micMeter = meters[.me]!
    let mic = deps.makeMic({ micMeter.measure($0); micSink.yield($0) }, { [weak self] problem in
      Task { @MainActor in self?.setCaptureProblem(.me, problem) }
    })
    try mic.start()
    self.mic = mic

    let systemSink = continuations[.them]!
    let systemMeter = meters[.them]!
    let system = deps.makeSystem({ systemMeter.measure($0); systemSink.yield($0) }, { [weak self] problem in
      Task { @MainActor in self?.setCaptureProblem(.them, problem) }
    })
    do {
      try system.start()
      self.system = system
    } catch {
      // The meeting still records your side.
      setCaptureProblem(.them, "Not hearing the other side: \(error.localizedDescription)")
    }
  }

  private func startChannels() async throws {
    let open = Array(channels.values)
    try await withThrowingTaskGroup(of: Void.self) { group in
      for channel in open { group.addTask { try await channel.start() } }
      try await group.waitForAll()
    }
  }

  /// Posts queued segments. A periodic flush skips if one is running; the final flush first
  /// waits for a running one (whose post may still be in flight), then drains the rest, so
  /// `/finish` never overtakes a post. Mid-meeting a failure waits for the next tick; on stop, a
  /// few quick retries. Returns a sentence when segments were left unsaved.
  @discardableResult
  private func flush(final: Bool = false) async -> String? {
    if let running = activeFlush {
      guard final else { return nil }
      _ = await running.value
    }
    // Unstructured, so cancelling the periodic flush loop doesn't cancel a post mid-flight.
    let task = Task { await self.drain(final: final) }
    activeFlush = task
    let problem = await task.value
    if activeFlush == task { activeFlush = nil }
    return problem
  }

  private func drain(final: Bool) async -> String? {
    var attempts = 0
    while !batcher.isEmpty {
      let batch = batcher.takeBatch()
      do {
        try await api.appendSegments(meetingID: meetingID, batch)
        saved += batch.count
      } catch {
        batcher.restore(batch)
        attempts += 1
        let message = "Some of the transcript couldn't be saved: \(error.localizedDescription)"
        guard final, attempts < 3 else {
          onEvent(.saveProblem(message))
          return message
        }
        try? await Task.sleep(for: deps.finalRetryDelay)
      }
    }
    return nil
  }

  private func setCaptureProblem(_ speaker: Speaker, _ problem: String?) {
    captureProblems[speaker] = problem
    onEvent(.captureProblem(speaker, problem))
    updateHealth()
  }

  private func tickLevels() {
    guard running else { return }
    let me = meters[.me]!.take()
    let them = meters[.them]!.take()
    onEvent(.levels(mic: me, system: them))
    updateHealth()
  }

  private func updateHealth() {
    func current(_ speaker: Speaker) -> SourceHealth {
      if captureProblems[speaker] != nil { return .error }
      if running, meters[speaker]!.silentFor >= deps.silenceAfter { return .silent }
      return .ok
    }
    let now = (mic: current(.me), system: current(.them))
    guard now != self.health else { return }
    self.health = now
    onEvent(.health(mic: now.mic, system: now.system))
  }

  private func teardown() async {
    flushTask?.cancel()
    flushTask = nil
    levelTask?.cancel()
    levelTask = nil
    mic?.stop()
    system?.stop()
    mic = nil
    system = nil
    for continuation in continuations.values { continuation.finish() }
    continuations = [:]
    for channel in channels.values { await channel.cancel() }
    channels = [:]
    pumps = []
  }
}

/// Peak level and "last heard anything" for one source, written from the audio thread.
public final class LevelMeter: @unchecked Sendable {
  private let lock = NSLock()
  private var peakRMS: Double = 0
  private var lastSignal = Date()

  public init() {}

  /// PCM16 mono. Anything above digital silence counts as signal.
  public func measure(_ pcm: Data) {
    let samples = PCM16.decode(pcm)
    guard !samples.isEmpty else { return }
    var sum: Double = 0
    var loud = false
    for s in samples {
      let v = Double(s) / 32768
      sum += v * v
      if s > 1 || s < -1 { loud = true }
    }
    let rms = (sum / Double(samples.count)).squareRoot()
    lock.withLock {
      peakRMS = max(peakRMS, rms)
      if loud { lastSignal = Date() }
    }
  }

  /// The loudest level since the last call, 0–1 on a −60…0 dBFS scale.
  public func take() -> Double {
    let rms = lock.withLock {
      defer { peakRMS = 0 }
      return peakRMS
    }
    return Self.scale(rms)
  }

  public var silentFor: TimeInterval { lock.withLock { Date().timeIntervalSince(lastSignal) } }

  public static func scale(_ rms: Double) -> Double {
    guard rms > 0 else { return 0 }
    let db = 20 * log10(rms)
    return min(1, max(0, (db + 60) / 60))
  }
}
