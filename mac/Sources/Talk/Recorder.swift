import Foundation
import TalkCore
import TalkRecording

/// One meeting being recorded from the menu: creates it on the server, then runs the shared
/// `RecordingPipeline` (TalkRecording) and turns its events into the menu's live line and warning.
/// Audio only ever goes to OpenAI and is never written anywhere.
@MainActor
final class Recorder: ObservableObject {
  enum State: Equatable {
    case idle
    case starting(title: String)
    case recording(meetingID: String, title: String, since: Date)
    case stopping(title: String)

    var isRecording: Bool {
      if case .recording = self { return true }
      return false
    }
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var liveLine: String?
  /// Something the person should know: system audio unavailable, transcription reconnecting.
  @Published private(set) var warning: String?
  @Published private(set) var lastError: String?
  /// The meeting just finished, so the menu can offer to open its notes.
  @Published private(set) var lastMeetingID: String?
  /// The calendar event being recorded, if any.
  private(set) var calendarEventID: String?

  private var pipeline: RecordingPipeline?
  private var problems: [Speaker: String] = [:]
  private var fallbackNotice: String?
  private var captureProblems: [Speaker: String] = [:]

  var isActive: Bool { state != .idle }

  func start(
    api: APIClient, title: String, startsAt: Date = Date(), calendarEventID: String? = nil, attendees: [Attendee] = []
  ) async {
    guard state == .idle else { return }
    lastError = nil
    warning = nil
    liveLine = nil
    problems = [:]
    fallbackNotice = nil
    captureProblems = [:]
    guard await CapturePermission.ensureMicrophone() else {
      lastError = "Talk needs the microphone. Allow it in System Settings → Privacy & Security → Microphone."
      return
    }
    state = .starting(title: title)
    self.calendarEventID = calendarEventID
    var createdID: String?
    do {
      let meeting = try await api.createMeeting(
        title: title, startsAt: startsAt, calendarEventId: calendarEventID, attendees: attendees)
      createdID = meeting.id
      let pipeline = RecordingPipeline(
        meetingID: meeting.id, api: api, language: Locale.current.language.languageCode?.identifier
      ) { [weak self] event in self?.handle(event) }
      self.pipeline = pipeline
      try await pipeline.start()
      state = .recording(meetingID: meeting.id, title: title, since: Date())
    } catch {
      pipeline = nil
      // Don't leave the meeting "recording" on the server; best effort.
      if let createdID { try? await api.finish(meetingID: createdID) }
      state = .idle
      self.calendarEventID = nil
      lastError = "Couldn't start recording: \(error.localizedDescription)"
    }
  }

  func stop() async {
    guard case .recording(let meetingID, let title, _) = state, let pipeline else { return }
    state = .stopping(title: title)
    let result = await pipeline.stop()
    self.pipeline = nil
    if let problem = result.problem {
      lastError = problem
    } else {
      lastMeetingID = meetingID
    }
    state = .idle
    calendarEventID = nil
    liveLine = nil
    warning = nil
  }

  // MARK: Private

  private func handle(_ event: RecordingEvent) {
    switch event {
    case .mode(let mode):
      fallbackNotice = mode == .fallback ? "Near-live transcription: live keys aren't available, so audio goes in 30-second chunks" : nil
      updateWarning()
    case .delta(let speaker, let text, _):
      liveLine = "\(speaker == .me ? "Me" : "Them"): \(Self.tail(text))"
    case .segment(let segment):
      liveLine = "\(segment.speaker == .me ? "Me" : "Them"): \(Self.tail(segment.text))"
    case .transcriptionProblem(let speaker, let problem):
      problems[speaker] = problem
      updateWarning()
    case .captureProblem(let speaker, let problem):
      captureProblems[speaker] = problem
      updateWarning()
    case .saveProblem(let message):
      lastError = message
    case .fallbackBacklog(let speaker, let message):
      problems[speaker] = message
      updateWarning()
    case .health, .levels:
      break
    }
  }

  private func updateWarning() {
    let parts = [fallbackNotice, captureProblems[.me], captureProblems[.them]] + [Speaker.me, .them].map { s in problems[s].map { "\(s == .me ? "Your mic" : "Their side"): \($0)" } }
    let text = parts.compactMap { $0 }.joined(separator: " · ")
    warning = text.isEmpty ? nil : text
  }

  /// The end of a long line, so the menu shows what's being said now.
  static func tail(_ text: String, limit: Int = 70) -> String {
    let clean = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard clean.count > limit else { return clean }
    return "…" + clean.suffix(limit)
  }
}
