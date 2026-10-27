import Foundation
import Network

/// A one-shot HTTP listener on 127.0.0.1, ephemeral port, for the OAuth redirect.
public final class LoopbackServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "openzen.loopback")
  private var expectation: CallbackExpectation?
  private var result: CheckedContinuation<String, Error>?
  /// Bumped per wait, so an earlier wait's timer can't end a later one.
  private var generation = 0

  public init() throws {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
    parameters.allowLocalEndpointReuse = true
    listener = try NWListener(using: parameters)
  }

  /// Starts listening; returns the port the system picked.
  public func start() async throws -> UInt16 {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
      // The handlers all run on `queue`, so `starting` needs no lock.
      queue.async {
        self.starting = continuation
        self.listener.stateUpdateHandler = { [weak self] state in self?.stateChanged(state) }
        self.listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        self.listener.start(queue: self.queue)
      }
    }
  }

  private var starting: CheckedContinuation<UInt16, Error>?

  private func stateChanged(_ state: NWListener.State) {
    guard let starting else { return }
    switch state {
    case .ready:
      self.starting = nil
      starting.resume(returning: listener.port?.rawValue ?? 0)
    case .failed(let error):
      self.starting = nil
      starting.resume(throwing: error)
    default: break
    }
  }

  /// Waits for one callback meeting `expectation`. Can be called again (a retried sign-in).
  public func waitForCode(_ expectation: CallbackExpectation, timeout: TimeInterval) async throws -> String {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
        queue.async {
          self.generation += 1
          let generation = self.generation
          self.expectation = expectation
          self.result = continuation
          self.queue.asyncAfter(deadline: .now() + timeout) {
            guard self.generation == generation else { return }
            self.finish(.failure(AuthError.message("Sign-in timed out. Try again.")))
          }
        }
      }
    } onCancel: {
      queue.async { self.finish(.failure(CancellationError())) }
    }
  }

  public func stop() { listener.cancel() }

  private func accept(_ connection: NWConnection) {
    connection.start(queue: queue)
    read(connection, head: Data())
  }

  private func read(_ connection: NWConnection, head: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, isComplete, error in
      guard let self else { return }
      var head = head
      if let data { head.append(data) }
      if LoopbackRedirect.isComplete(head) || isComplete || error != nil || head.count > 32 * 1024 {
        self.respond(connection, head: String(decoding: head, as: UTF8.self))
      } else {
        self.read(connection, head: head)
      }
    }
  }

  private func respond(_ connection: NWConnection, head: String) {
    guard let expectation, result != nil else {
      let reply = LoopbackRedirect.response(status: 404, title: "Not found", message: "")
      connection.send(content: reply, completion: .contentProcessed { _ in connection.cancel() })
      return
    }
    let outcome = LoopbackRedirect.parse(
      head: head, expectedState: expectation.state, expectedIssuer: expectation.issuer, issRequired: expectation.issRequired)
    let reply: Data
    switch outcome {
    case .code(let code):
      reply = LoopbackRedirect.response(status: 200, title: "You're signed in to OpenZen", message: "You can close this tab.")
      finish(.success(code))
    case .denied(let error, let description):
      reply = LoopbackRedirect.response(status: 200, title: "Sign-in cancelled", message: "You can close this tab.")
      if error == "invalid_client" {
        finish(.failure(OAuthError.invalidClient))
      } else {
        let why = error == "access_denied" ? "Sign-in was cancelled." : "Sign-in failed: \(description ?? error)."
        finish(.failure(AuthError.message(why)))
      }
    case .invalid(let why):
      reply = LoopbackRedirect.response(status: 400, title: "Sign-in failed", message: why)
      finish(.failure(AuthError.message(why)))
    case .ignore:
      reply = LoopbackRedirect.response(status: 404, title: "Not found", message: "")
    }
    connection.send(content: reply, completion: .contentProcessed { _ in connection.cancel() })
  }

  private func finish(_ outcome: Result<String, Error>) {
    guard let result else { return }
    self.result = nil
    expectation = nil
    result.resume(with: outcome)
  }
}
