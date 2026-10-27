@preconcurrency import AVFoundation
import Foundation
import OpenZenCore

/// One meeting being recorded: creates it on the server, captures mic and system audio, streams
/// each to its own transcription session, and posts finished segments every ten seconds.
/// Audio only ever goes to OpenAI and is never written anywhere.
@MainActor
final class Recorder: ObservableObject {
  enum State: Equatable {
    case idle
    case starting(title: String)
    case recording(meetingID: String, title: String, since: Date)
    case stopping(title: String)
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var liveLine: String?
  /// Something the person should know: system audio unavailable, transcription reconnecting.
  @Published private(set) var warning: String?
  @Published private(set) var lastError: String?
  /// The meeting just finished, so the menu can offer to open its notes.
  @Published private(set) var lastMeetingID: String?

  private var api: APIClient?
  private var mic: MicCapture?
  private var system: SystemAudioCapture?
  private var channels: [Speaker: any SpeakerChannel] = [:]
  private var pumps: [Task<Void, Never>] = []
  private var continuations: [Speaker: AsyncStream<Data>.Continuation] = [:]
  private var batcher = SegmentBatcher()
  private var flushTask: Task<Void, Never>?
  private var flushing = false
  private var problems: [Speaker: String] = [:]
  private var systemWarning: String?
  private var fallbackNotice: String?

  var isActive: Bool { state != .idle }

  func start(api: APIClient, title: String, startsAt: Date = Date(), calendarEventID: String? = nil) async {
    guard state == .idle else { return }
    lastError = nil
    warning = nil
    liveLine = nil
    problems = [:]
    systemWarning = nil
    fallbackNotice = nil
    guard await Permissions.ensureMicrophone() else {
      lastError = "OpenZen needs the microphone. Allow it in System Settings → Privacy & Security → Microphone."
      return
    }
    state = .starting(title: title)
    self.api = api
    batcher = SegmentBatcher()
    var createdID: String?
    do {
      let meeting = try await api.createMeeting(title: title, startsAt: startsAt, calendarEventId: calendarEventID)
      createdID = meeting.id
      try await startCapture(meetingID: meeting.id, api: api)
      state = .recording(meetingID: meeting.id, title: title, since: Date())
      flushTask = Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(SegmentBatcher.interval))
          await self?.flush(meetingID: meeting.id)
        }
      }
    } catch {
      await teardown()
      // Don't leave the meeting "recording" on the server; best effort.
      if let createdID { try? await api.finish(meetingID: createdID) }
      state = .idle
      lastError = "Couldn't start recording: \(error.localizedDescription)"
    }
  }

  func stop() async {
    guard case .recording(let meetingID, let title, _) = state else { return }
    state = .stopping(title: title)
    flushTask?.cancel()
    flushTask = nil
    // Stop the audio first, then let each session finish the turns it has.
    mic?.stop()
    system?.stop()
    for continuation in continuations.values { continuation.finish() }
    for pump in pumps { await pump.value }
    await withTaskGroup(of: Void.self) { group in
      for channel in channels.values { group.addTask { await channel.finish() } }
    }
    // Segments reach the batcher through main-actor tasks; let the last ones land.
    try? await Task.sleep(for: .milliseconds(300))
    await flush(meetingID: meetingID, final: true)
    do {
      try await api?.finish(meetingID: meetingID)
      lastMeetingID = meetingID
    } catch {
      lastError = "The recording stopped, but OpenZen couldn't be told to write notes: \(error.localizedDescription)"
    }
    await teardown()
    state = .idle
    liveLine = nil
    warning = nil
  }

  // MARK: Private

  private func startCapture(meetingID: String, api: APIClient) async throws {
    let language = Locale.current.language.languageCode?.identifier
    let onLive: @Sendable (Speaker, String) -> Void = { [weak self] speaker, text in
      Task { @MainActor in self?.liveLine = "\(speaker == .me ? "Me" : "Them"): \(Self.tail(text))" }
    }
    let onProblem: @Sendable (Speaker, String?) -> Void = { [weak self] speaker, problem in
      Task { @MainActor in self?.setProblem(speaker, problem) }
    }
    for speaker in [Speaker.me, .them] {
      channels[speaker] = TranscriptionChannel(
        speaker: speaker, language: language,
        fetchToken: { try await api.transcriptionToken(meetingID: meetingID, source: speaker == .me ? "mic" : "system", language: language) },
        onSegment: { [weak self] speaker, t0, t1, text in
          Task { @MainActor in self?.batcher.add(speaker: speaker, startedMs: t0, endedMs: t1, text: text) }
        },
        onLive: onLive, onProblem: onProblem)
    }
    // Both keys first: if the Worker can't mint them, decide before touching audio.
    do {
      try await startChannels()
    } catch let error as APIError where error.isRealtimeUnavailable {
      // No live keys: send 30 s chunks to the Worker instead (SPEC "Fallback").
      for channel in channels.values { await channel.cancel() }
      let seq = SeqCounter()
      for speaker in [Speaker.me, .them] {
        channels[speaker] = ChunkChannel(
          speaker: speaker, language: language, seq: seq,
          upload: { wav, number, t0, t1 in
            try await api.appendAudioChunk(
              meetingID: meetingID, wav: wav, seq: number, startedMs: t0, endedMs: t1, speaker: speaker, language: language)
          },
          onLive: onLive, onProblem: onProblem)
      }
      try await startChannels()
      fallbackNotice = "Near-live transcription: live keys aren't available, so audio goes in 30-second chunks"
      updateWarning()
    }
    for speaker in [Speaker.me, .them] {
      let channel = channels[speaker]!
      // Ordered delivery from the audio thread to the channel.
      let (stream, continuation) = AsyncStream<Data>.makeStream(bufferingPolicy: .bufferingNewest(600))
      continuations[speaker] = continuation
      pumps.append(Task.detached { for await chunk in stream { await channel.feed(chunk) } })
    }

    let micSink = continuations[.me]!
    let mic = MicCapture { micSink.yield($0) }
    try mic.start()
    self.mic = mic

    let systemSink = continuations[.them]!
    let system = SystemAudioCapture { systemSink.yield($0) }
    do {
      try system.start()
      self.system = system
    } catch {
      // The meeting still records your side.
      systemWarning = "Not hearing the other side: \(error.localizedDescription)"
      updateWarning()
    }
  }

  private func startChannels() async throws {
    try await withThrowingTaskGroup(of: Void.self) { group in
      for channel in channels.values { group.addTask { try await channel.start() } }
      try await group.waitForAll()
    }
  }

  private func flush(meetingID: String, final: Bool = false) async {
    guard !flushing, let api else { return }
    flushing = true
    defer { flushing = false }
    var attempts = 0
    while !batcher.isEmpty {
      let batch = batcher.takeBatch()
      do {
        try await api.appendSegments(meetingID: meetingID, batch)
      } catch {
        batcher.restore(batch)
        attempts += 1
        // Mid-meeting, try again next tick. On stop, a few quick retries.
        guard final, attempts < 3 else {
          if final { lastError = "Some of the transcript couldn't be saved: \(error.localizedDescription)" }
          return
        }
        try? await Task.sleep(for: .seconds(2))
      }
    }
  }

  private func setProblem(_ speaker: Speaker, _ problem: String?) {
    problems[speaker] = problem
    updateWarning()
  }

  private func updateWarning() {
    let parts = [fallbackNotice, systemWarning] + [Speaker.me, .them].map { s in problems[s].map { "\(s == .me ? "Your mic" : "Their side"): \($0)" } }
    let text = parts.compactMap { $0 }.joined(separator: " · ")
    warning = text.isEmpty ? nil : text
  }

  private func teardown() async {
    flushTask?.cancel()
    flushTask = nil
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

  /// The end of a long line, so the menu shows what's being said now.
  static func tail(_ text: String, limit: Int = 70) -> String {
    let clean = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard clean.count > limit else { return clean }
    return "…" + clean.suffix(limit)
  }
}
