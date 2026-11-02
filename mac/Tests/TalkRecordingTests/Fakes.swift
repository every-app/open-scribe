import Foundation
import TalkCore
import TalkRecording

/// Records requests and answers them from a handler (status, body).
final class FakeWorker: HTTPTransport, @unchecked Sendable {
  typealias Handler = @Sendable (_ path: String, _ token: String) -> (Int, String)
  private let lock = NSLock()
  private var handler: Handler
  private var _requests: [URLRequest] = []

  init(_ handler: @escaping Handler) { self.handler = handler }

  var requests: [URLRequest] { lock.withLock { _requests } }
  func paths() -> [String] { requests.map { $0.url!.path } }
  func tokens(for path: String) -> [String] {
    requests.filter { $0.url!.path == path }.map { ($0.value(forHTTPHeaderField: "Authorization") ?? "").replacingOccurrences(of: "Bearer ", with: "") }
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let token = (request.value(forHTTPHeaderField: "Authorization") ?? "").replacingOccurrences(of: "Bearer ", with: "")
    let (status, body) = lock.withLock {
      _requests.append(request)
      return handler(request.url!.path, token)
    }
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
    return (Data(body.utf8), response)
  }

  /// A Worker that mints keys, stores segments and finishes meeting m1.
  static func happy(segments: @escaping @Sendable (String) -> Int = { _ in 204 }) -> FakeWorker {
    FakeWorker { path, token in
      switch path {
      case "/api/v1/meetings/m1/transcription-token":
        (200, #"{"value":"ek_abc","expiresAt":4102444800,"model":"gpt-live-transcribe"}"#)
      case "/api/v1/meetings/m1/segments": (segments(token), "")
      case "/api/v1/meetings/m1/finish": (202, #"{"ok":true}"#)
      default: (404, "")
      }
    }
  }
}

/// A capture source the test drives by hand.
final class FakeSource: AudioSource, @unchecked Sendable {
  let onAudio: @Sendable (Data) -> Void
  let onInterrupted: @Sendable (String?) -> Void
  let failStart: Bool
  private(set) var started = false
  private(set) var stopped = false

  init(onAudio: @escaping @Sendable (Data) -> Void, onInterrupted: @escaping @Sendable (String?) -> Void, failStart: Bool = false) {
    self.onAudio = onAudio
    self.onInterrupted = onInterrupted
    self.failStart = failStart
  }

  func start() throws {
    if failStart { throw CaptureError("no device") }
    started = true
  }

  func stop() { stopped = true }

  /// 100 ms of a quiet tone.
  func speak() { onAudio(PCM16.encode((0..<2400).map { sin(Float($0) / 10) * 0.1 })) }
}

/// A channel that fetches its key like the real one, then turns every chunk fed into a delta and
/// a finished segment.
actor FakeChannel: SpeakerChannel {
  let speaker: Speaker
  let fetchToken: (@Sendable () async throws -> TranscriptionToken)?
  let callbacks: ChannelCallbacks
  private var clock = 0
  private var turns = 0

  init(speaker: Speaker, fetchToken: (@Sendable () async throws -> TranscriptionToken)?, callbacks: ChannelCallbacks) {
    self.speaker = speaker
    self.fetchToken = fetchToken
    self.callbacks = callbacks
  }

  func start() async throws { _ = try await fetchToken?() }

  func feed(_ pcm: Data) async {
    let ms = pcm.count / 48
    turns += 1
    callbacks.delta(speaker, "turn \(turns)", "item-\(speaker.rawValue)-\(turns)")
    callbacks.segment(speaker, clock, clock + ms, "\(speaker.rawValue) turn \(turns)")
    clock += ms
  }

  func finish() async {}
  func cancel() async {}
}

/// Hands out fake sources and channels and remembers them.
final class FakeRig: @unchecked Sendable {
  private let lock = NSLock()
  private var _mic: FakeSource?
  private var _system: FakeSource?
  var systemFails = false
  var fallbackUsed = false

  var mic: FakeSource? { lock.withLock { _mic } }
  var system: FakeSource? { lock.withLock { _system } }

  var dependencies: RecordingPipeline.Dependencies {
    var deps = RecordingPipeline.Dependencies(
      makeMic: { [self] onAudio, onInterrupted in
        let source = FakeSource(onAudio: onAudio, onInterrupted: onInterrupted)
        lock.withLock { _mic = source }
        return source
      },
      makeSystem: { [self] onAudio, onInterrupted in
        let source = FakeSource(onAudio: onAudio, onInterrupted: onInterrupted, failStart: systemFails)
        lock.withLock { _system = source }
        return source
      },
      makeRealtime: { speaker, _, fetchToken, callbacks in FakeChannel(speaker: speaker, fetchToken: fetchToken, callbacks: callbacks) },
      makeFallback: { [self] speaker, _, _, _, callbacks in
        lock.withLock { fallbackUsed = true }
        return FakeChannel(speaker: speaker, fetchToken: nil, callbacks: callbacks)
      })
    deps.flushInterval = 3600
    deps.settle = .milliseconds(20)
    deps.finalRetryDelay = .milliseconds(10)
    deps.levelInterval = .seconds(3600)
    return deps
  }
}

/// Lines the server wrote, decoded.
final class Output: @unchecked Sendable {
  private let lock = NSLock()
  private var _lines: [String] = []

  func write(_ line: String) { lock.withLock { _lines.append(line) } }

  var lines: [String] { lock.withLock { _lines } }
  var objects: [JSONValue] { lines.map { try! JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) } }
  func events(_ name: String) -> [JSONValue] { objects.filter { $0["event"]?.string == name } }
  func response(_ id: Int) -> JSONValue? { objects.first { $0["id"] == .int(id) } }

  /// Polls until `condition` holds (or a second passes).
  func waitFor(_ condition: () -> Bool) async -> Bool {
    for _ in 0..<200 {
      if condition() { return true }
      try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
  }
}

final class FakeProcesses: InputProcessSource, @unchecked Sendable {
  private let lock = NSLock()
  private var _now: [InputProcess] = []
  var now: [InputProcess] {
    get { lock.withLock { _now } }
    set { lock.withLock { _now = newValue } }
  }
  func processesUsingInput() -> [InputProcess] { now }
}

final class MicGate: @unchecked Sendable {
  private let lock = NSLock()
  private var _allowed = true
  private var _asked = 0
  var allowed: Bool {
    get { lock.withLock { _allowed } }
    set { lock.withLock { _allowed = newValue } }
  }
  var asked: Int { lock.withLock { _asked } }
  func ask() -> Bool { lock.withLock { _asked += 1; return _allowed } }
}

func environment(worker: FakeWorker, rig: FakeRig, processes: FakeProcesses = FakeProcesses(), mic: MicGate = MicGate()) -> HelperEnvironment {
  var env = HelperEnvironment(
    version: "9.9.9", macos: "15.0.0",
    micStatus: { mic.allowed ? .granted : .denied },
    requestMic: { mic.ask() },
    primeSystemAudio: {},
    pipeline: rig.dependencies, transport: worker, processSource: processes)
  env.defaultLanguage = "en"
  env.detectInterval = .milliseconds(5)
  env.callDebounce = 0.05
  env.tokenTimeout = .seconds(5)
  return env
}
