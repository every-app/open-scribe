import AppKit
import Foundation
import Network
import OpenZenCore

/// "Sign in with Every App": discovery and registration on the Gateway, the authorization page
/// in the system browser, the code back on a loopback redirect, then the token exchange.
enum OAuthSignIn {
  /// What a sign-in asks the Gateway for: OpenZen's API only (docs/SPEC.md, "Sign in with Every App").
  static let scope: String? = "app:open-zen"
  static let timeout: TimeInterval = 5 * 60

  /// `gatewayURL` is the issuer; `appURL` is the resource the token is for (the app's origin).
  static func run(gatewayURL: URL, appURL: URL, client: OAuthClient = OAuthClient()) async throws -> OAuthGrant {
    guard let resource = appURL.origin?.absoluteString else { throw AuthError.message("That app URL isn't valid.") }
    let metadata = try await client.discover(issuer: gatewayURL)

    let server = try LoopbackServer()
    defer { server.stop() }
    let port = try await server.start()
    // RFC 8252 §7.3: the IP literal, not "localhost".
    let redirectURI = "http://127.0.0.1:\(port)\(LoopbackRedirect.path)"

    guard let registration = metadata.registrationEndpoint else {
      throw OAuthError.registrationFailed("It doesn't offer dynamic client registration.")
    }
    // A fresh client per sign-in; the grant (in the Keychain) keeps its id for refreshes.
    let clientID = try await client.register(
      at: registration, redirectURIs: ["http://127.0.0.1\(LoopbackRedirect.path)", redirectURI], scope: scope)

    let pkce = PKCE()
    let state = Random.token()
    let url = OAuthClient.authorizationURL(
      metadata: metadata, clientID: clientID, redirectURI: redirectURI, pkce: pkce, state: state, resource: resource,
      scope: scope)
    await MainActor.run { _ = NSWorkspace.shared.open(url) }

    let code = try await server.waitForCode(state: state, timeout: timeout)
    return try await client.exchange(
      code: code, metadata: metadata, clientID: clientID, redirectURI: redirectURI, pkce: pkce, resource: resource,
      appURL: appURL.origin ?? appURL)
  }
}

/// A one-shot HTTP listener on 127.0.0.1, ephemeral port, for the OAuth redirect.
final class LoopbackServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "openzen.loopback")
  private var expectedState = ""
  private var result: CheckedContinuation<String, Error>?
  private var finished = false

  init() throws {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
    parameters.allowLocalEndpointReuse = true
    listener = try NWListener(using: parameters)
  }

  /// Starts listening; returns the port the system picked.
  func start() async throws -> UInt16 {
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

  func waitForCode(state: String, timeout: TimeInterval) async throws -> String {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
        queue.async {
          self.expectedState = state
          self.result = continuation
          self.queue.asyncAfter(deadline: .now() + timeout) {
            self.finish(.failure(AuthError.message("Sign-in timed out. Try again.")))
          }
        }
      }
    } onCancel: {
      queue.async { self.finish(.failure(CancellationError())) }
    }
  }

  func stop() { listener.cancel() }

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
    let outcome = LoopbackRedirect.parse(head: head, expectedState: expectedState)
    let reply: Data
    switch outcome {
    case .code(let code):
      reply = LoopbackRedirect.response(status: 200, title: "You're signed in to OpenZen", message: "You can close this tab.")
      finish(.success(code))
    case .denied(let error, let description):
      reply = LoopbackRedirect.response(status: 200, title: "Sign-in cancelled", message: "You can close this tab.")
      let why = error == "access_denied" ? "Sign-in was cancelled." : "Sign-in failed: \(description ?? error)."
      finish(.failure(AuthError.message(why)))
    case .invalid(let why):
      reply = LoopbackRedirect.response(status: 400, title: "Sign-in failed", message: why)
      finish(.failure(AuthError.message(why)))
    case .ignore:
      reply = LoopbackRedirect.response(status: 404, title: "Not found", message: "")
    }
    connection.send(content: reply, completion: .contentProcessed { _ in connection.cancel() })
  }

  private func finish(_ outcome: Result<String, Error>) {
    guard !finished, let result else { return }
    finished = true
    self.result = nil
    result.resume(with: outcome)
  }
}
