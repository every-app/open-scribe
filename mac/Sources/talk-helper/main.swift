import Foundation
import TalkRecording
import os

// talk-helper: Talk's audio capture and transcription, driven by the desktop app over stdin and
// stdout with newline-delimited JSON (docs/desktop-plan.md "Helper protocol (v1)"). stdout
// carries protocol lines only; logs go to stderr and os_log. Never logs a token.

let logger = Logger(subsystem: "com.everyapp.talk", category: "helper")

@Sendable func log(_ message: String) {
  logger.info("\(message, privacy: .public)")
  FileHandle.standardError.write(Data("talk-helper: \(message)\n".utf8))
}

/// Whole lines to fd 1, one writer at a time. POSIX write: a closed pipe is an error to ignore,
/// not an exception.
let stdoutLock = NSLock()
@Sendable func writeLine(_ line: String) {
  let data = Array((line + "\n").utf8)
  stdoutLock.withLock {
    var offset = 0
    while offset < data.count {
      let n = data[offset...].withUnsafeBytes { write(STDOUT_FILENO, $0.baseAddress, $0.count) }
      if n <= 0 {
        if n < 0, errno == EINTR { continue }
        return
      }
      offset += n
    }
  }
}

signal(SIGPIPE, SIG_IGN)

@MainActor
func run() async {
  let server = HelperServer(environment: .live, write: writeLine, log: log)
  let devices = DeviceWatcher { input, output in
    Task { @MainActor in server.deviceChanged(input: input, output: output) }
  }
  let requests = RequestTracker()

  // SIGTERM/SIGINT: the same clean exit as stdin closing.
  var exiting = false
  func exitCleanly(_ why: String) async {
    guard !exiting else { return }
    exiting = true
    log("\(why); exiting")
    // Don't hang forever on a stop that can't finish.
    DispatchQueue.global().asyncAfter(deadline: .now() + 45) {
      log("shutdown took too long")
      exit(1)
    }
    let started = ContinuousClock.now
    // A recording (or a record.stop in progress) is finished properly first: flush + /finish.
    await server.shutdown()
    // Then give requests already read a moment to answer, but don't wait on one that's only
    // waiting (a permission prompt): that used to hold the exit until the watchdog.
    let answered = await requests.drain()
    if !answered { log("exiting with \(requests.pending) request(s) unanswered") }
    log("exit after \(ContinuousClock.now - started)")
    withExtendedLifetime(devices) {}
    exit(0)
  }
  var signalSources: [DispatchSourceSignal] = []
  for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { Task { @MainActor in await exitCleanly(sig == SIGTERM ? "SIGTERM" : "SIGINT") } }
    source.resume()
    signalSources.append(source)
  }

  log("started (pid \(getpid()))")
  do {
    for try await line in FileHandle.standardInput.bytes.lines {
      requests.begin()
      Task { @MainActor in
        await server.handle(line)
        requests.end()
      }
    }
  } catch {
    log("stdin failed: \(error.localizedDescription)")
  }
  _ = signalSources
  await exitCleanly("stdin closed")
}

await run()
