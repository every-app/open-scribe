import Foundation
import TalkCore

/// What the helper needs from the outside world, so the dispatcher runs in tests without
/// hardware, permissions or a network.
public struct HelperEnvironment: Sendable {
  public var version: String
  public var macos: String
  public var micStatus: @Sendable () -> CapturePermission.Status
  /// Asks for the mic if never asked; true when allowed.
  public var requestMic: @Sendable () async -> Bool
  /// Starts a short tap so macOS shows the system-audio prompt.
  public var primeSystemAudio: @Sendable () -> Void
  public var pipeline: RecordingPipeline.Dependencies
  public var transport: any HTTPTransport
  public var processSource: any InputProcessSource
  public var detectInterval: Duration = .seconds(1)
  public var callDebounce: TimeInterval = CallDetector.defaultDebounce
  /// How long a 401 waits for `token.update` before giving up.
  public var tokenTimeout: Duration = .seconds(60)
  public var defaultLanguage: String? = Locale.current.language.languageCode?.identifier
  public var now: @Sendable () -> Date = { Date() }

  public init(
    version: String, macos: String, micStatus: @escaping @Sendable () -> CapturePermission.Status,
    requestMic: @escaping @Sendable () async -> Bool, primeSystemAudio: @escaping @Sendable () -> Void,
    pipeline: RecordingPipeline.Dependencies, transport: any HTTPTransport, processSource: any InputProcessSource
  ) {
    self.version = version
    self.macos = macos
    self.micStatus = micStatus
    self.requestMic = requestMic
    self.primeSystemAudio = primeSystemAudio
    self.pipeline = pipeline
    self.transport = transport
    self.processSource = processSource
  }

  public static var live: HelperEnvironment {
    let v = ProcessInfo.processInfo.operatingSystemVersion
    return HelperEnvironment(
      version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0",
      macos: "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)",
      micStatus: { CapturePermission.microphone },
      requestMic: { await CapturePermission.ensureMicrophone() },
      primeSystemAudio: { DispatchQueue.main.async { CapturePermission.primeSystemAudio() } },
      pipeline: .live,
      transport: URLSessionTransport(followRedirects: false),
      processSource: CoreAudioProcessSource())
  }
}

/// Protocol v1 (docs/desktop-plan.md "Helper protocol (v1)"): one response per request, events
/// for everything else. Lines go to `write`, which must keep each line whole.
@MainActor
public final class HelperServer {
  private let env: HelperEnvironment
  private let write: @Sendable (String) -> Void
  private let log: @Sendable (String) -> Void

  private var pipeline: RecordingPipeline?
  private var auth: HelperAuth?
  private var starting = false
  /// `record.stop` arrived while `record.start` was still asking for the mic or fetching keys.
  private var startCancelled = false
  /// The pipeline a pending `record.start` is starting.
  private var startingPipeline: RecordingPipeline?
  private var startWaiters: [CheckedContinuation<Void, Never>] = []
  private var stopping = false
  private var closing = false
  private var mode: RecordingMode = .realtime
  private var health: (mic: SourceHealth, system: SourceHealth) = (.ok, .ok)
  private var detectTask: Task<Void, Never>?

  public init(environment: HelperEnvironment, write: @escaping @Sendable (String) -> Void, log: @escaping @Sendable (String) -> Void = { _ in }) {
    self.env = environment
    self.write = write
    self.log = log
  }

  public var isRecording: Bool { pipeline != nil }
  public var isDetecting: Bool { detectTask != nil }

  /// One line from stdin. Returns once the request is answered.
  public func handle(_ line: String) async {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    switch HelperCodec.decode(trimmed) {
    case .failure(.notJSON):
      write(HelperCodec.failure(id: .null, HelperError("bad_request", "Each line must be a JSON object")))
    case .failure(.badRequest(let id, let message)):
      write(HelperCodec.failure(id: id, HelperError("bad_request", message)))
    case .success(let request):
      do {
        let result = try await dispatch(request)
        write(HelperCodec.success(id: request.id, result: result))
      } catch let error as HelperError {
        log("\(request.cmd) failed: \(error.code)")
        write(HelperCodec.failure(id: request.id, error))
      } catch {
        write(HelperCodec.failure(id: request.id, HelperError("internal", error.localizedDescription)))
      }
    }
  }

  /// stdin closed (or SIGTERM): stop detecting, and stop a recording properly (post the last
  /// segments and finish) without waiting for tokens nobody will send.
  public func shutdown() async {
    closing = true
    setDetection(false)
    await auth?.close()
    if pipeline != nil || starting, !stopping { _ = try? await stop() }
  }

  /// The default input or output device changed.
  public func deviceChanged(input: String?, output: String?) {
    var fields: [String: JSONValue] = [:]
    if let input { fields["input"] = .string(input) }
    if let output { fields["output"] = .string(output) }
    emit("device.changed", fields)
  }

  // MARK: Requests

  func dispatch(_ request: HelperRequest) async throws -> JSONValue {
    let p = request.params
    switch request.cmd {
    case "hello":
      if let version = p["protocol"]?.int, version != HelperCodec.protocolVersion {
        throw HelperError("unsupported_protocol", "This helper speaks protocol \(HelperCodec.protocolVersion)")
      }
      return ["protocol": .int(HelperCodec.protocolVersion), "version": .string(env.version), "macos": .string(env.macos)]
    case "permissions.status":
      return permissions()
    case "permissions.request":
      switch p["kind"]?.string {
      case "mic": _ = await env.requestMic()
      case "systemAudio": env.primeSystemAudio()
      default: throw HelperError.badParams("kind must be \"mic\" or \"systemAudio\"")
      }
      return permissions()
    case "record.start":
      return try await start(p)
    case "record.stop":
      return try await stop()
    case "token.update":
      guard let token = p["accessToken"]?.string, !token.isEmpty else { throw HelperError.badParams("accessToken is required") }
      await auth?.update(token)
      return [:]
    case "detect.set":
      guard let enabled = p["enabled"]?.bool else { throw HelperError.badParams("enabled must be true or false") }
      setDetection(enabled)
      return [:]
    default:
      throw HelperError("unknown_command", "Unknown cmd \(request.cmd)")
    }
  }

  private func permissions() -> JSONValue {
    // System audio has no API to read; macOS asks when the first tap starts.
    ["mic": .string(env.micStatus().rawValue), "systemAudio": .string(CapturePermission.Status.unknown.rawValue)]
  }

  private func start(_ p: JSONValue) async throws -> JSONValue {
    guard !closing else { throw HelperError("shutting_down", "The helper is exiting") }
    guard pipeline == nil, !starting else { throw HelperError("busy", "Already recording") }
    guard let meetingID = p["meetingId"]?.string, !meetingID.isEmpty else { throw HelperError.badParams("meetingId is required") }
    guard let base = p["apiBase"]?.string, let apiBase = URL.typed(base) else {
      throw HelperError.badParams("apiBase must be an https URL (http only for localhost)")
    }
    guard let token = p["accessToken"]?.string, !token.isEmpty else { throw HelperError.badParams("accessToken is required") }
    let language = p["language"]?.string ?? env.defaultLanguage
    var options = RecordingOptions()
    if let value = p["echoCancellation"], value != .null {
      guard let enabled = value.bool else { throw HelperError.badParams("echoCancellation must be true or false") }
      options.echoCancellation = enabled
    }

    starting = true
    startCancelled = false
    defer {
      starting = false
      startingPipeline = nil
      let waiters = startWaiters
      startWaiters = []
      for waiter in waiters { waiter.resume() }
    }
    guard await env.requestMic() else {
      throw HelperError("mic_denied", "Talk needs the microphone. Allow it in System Settings → Privacy & Security → Microphone.")
    }
    if startCancelled { throw Self.cancelledError }
    let auth = HelperAuth(appURL: apiBase, token: token, timeout: env.tokenTimeout) { [weak self] in
      Task { @MainActor in self?.emit("token.needed") }
    }
    let pipeline = RecordingPipeline(
      meetingID: meetingID, api: APIClient(auth: auth, transport: env.transport), language: language,
      options: options, dependencies: env.pipeline
    ) { [weak self] event in self?.recordingEvent(event) }
    mode = .realtime
    health = (.ok, .ok)
    self.auth = auth
    startingPipeline = pipeline
    do {
      try await pipeline.start()
    } catch {
      self.auth = nil
      if startCancelled || error is RecordingAborted { throw Self.cancelledError }
      throw Self.startError(error)
    }
    self.pipeline = pipeline
    log("recording started (\(mode.rawValue)\(options.echoCancellation ? ", voice processing" : ""))")
    emitState()
    if closing { _ = try? await stop() }
    return ["startedAt": .string(env.now().formatted(.iso8601))]
  }

  static let cancelledError = HelperError("cancelled", "record.stop arrived before the recording started")

  private func stop() async throws -> JSONValue {
    if starting, pipeline == nil, !stopping {
      if startingPipeline?.isRunning == true {
        // Capture already began: let start finish, then stop it like any recording.
        await withCheckedContinuation { startWaiters.append($0) }
      } else {
        // Still asking for the mic or fetching keys: start won't capture. A pending 401 wait
        // fails at once.
        startCancelled = true
        startingPipeline?.abort()
        await auth?.close()
        log("start cancelled by stop")
        return ["segments": 0, "cancelled": true]
      }
    }
    guard let pipeline, !stopping else { throw HelperError("not_recording", "Not recording") }
    stopping = true
    defer { stopping = false }
    let result = await pipeline.stop()
    self.pipeline = nil
    await auth?.close()
    auth = nil
    let echo = pipeline.echoCounts
    log("recording stopped (\(result.segments) segments; echo: \(echo.dropped) dropped, \(echo.trimmed) trimmed)")
    if let problem = result.problem { emitError("save_failed", problem) }
    emitState()
    return ["segments": .int(result.segments)]
  }

  static func startError(_ error: Error) -> HelperError {
    switch error {
    case APIError.signedOut: HelperError("signed_out", error.localizedDescription)
    case APIError.accessLogin: HelperError("access_login", error.localizedDescription)
    case APIError.server(let status, let code, _): HelperError(code ?? "http_\(status)", error.localizedDescription)
    case is CaptureError: HelperError("capture_failed", error.localizedDescription)
    default: HelperError("start_failed", error.localizedDescription)
    }
  }

  // MARK: Events

  private func recordingEvent(_ event: RecordingEvent) {
    switch event {
    case .mode(let mode):
      self.mode = mode
      if pipeline != nil { emitState() }
    case .delta(let speaker, let text, let itemID):
      emit("transcript.delta", ["speaker": .string(speaker.rawValue), "text": .string(text), "itemId": .string(itemID)])
    case .segment(let s):
      emit("transcript.segment", [
        "seq": .int(s.seq), "speaker": .string(s.speaker.rawValue), "text": .string(s.text),
        "startedMs": .int(s.startedMs), "endedMs": .int(s.endedMs),
      ])
    case .transcriptionProblem(let speaker, let problem):
      if let problem { emitError("transcription", "\(speaker == .me ? "Your mic" : "Their side"): \(problem)") }
    case .captureProblem(_, let problem):
      if let problem { emitError("capture", problem) }
    case .health(let mic, let system):
      health = (mic, system)
      if pipeline != nil { emitState() }
    case .levels(let mic, let system):
      emit("levels", ["mic": .double(Self.round(mic)), "system": .double(Self.round(system))])
    case .saveProblem(let message):
      emitError("save_failed", message)
    case .fallbackBacklog(let speaker, let message):
      emitError("fallback_backlog", "\(speaker == .me ? "Your mic" : "Their side"): \(message)")
    }
  }

  private static func round(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }

  private func emitState() {
    var fields: [String: JSONValue] = [
      "recording": .bool(pipeline != nil), "mode": .string(mode.rawValue),
      "mic": .string(health.mic.rawValue), "system": .string(health.system.rawValue),
    ]
    if let id = pipeline?.meetingID { fields["meetingId"] = .string(id) }
    emit("state", fields)
  }

  private func emitError(_ code: String, _ message: String, fatal: Bool = false) {
    log("error \(code)")
    emit("error", ["code": .string(code), "message": .string(message), "fatal": .bool(fatal)])
  }

  private func emit(_ name: String, _ fields: [String: JSONValue] = [:]) {
    write(HelperCodec.event(name, fields))
  }

  // MARK: Call detection

  private func setDetection(_ enabled: Bool) {
    if !enabled {
      detectTask?.cancel()
      detectTask = nil
      return
    }
    guard detectTask == nil else { return }
    var watcher = CallWatcher(source: env.processSource, debounce: env.callDebounce)
    let interval = env.detectInterval
    let now = env.now
    detectTask = Task { [weak self] in
      while !Task.isCancelled {
        let events = watcher.poll(now: now())
        for event in events { self?.callEvent(event) }
        try? await Task.sleep(for: interval)
      }
    }
  }

  private func callEvent(_ event: CallEvent) {
    switch event {
    case .started(let app):
      log("call started: \(app.bundleID)")
      emit("call.started", ["bundleId": .string(app.bundleID), "appName": .string(app.name)])
    case .ended(let app):
      log("call ended: \(app.bundleID)")
      emit("call.ended", ["bundleId": .string(app.bundleID), "appName": .string(app.name)])
    }
  }
}
