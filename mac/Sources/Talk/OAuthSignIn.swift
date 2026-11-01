import AppKit
import Foundation
import Network
import TalkCore

/// "Sign in with Every App" (docs/SPEC.md): `SignInFlow` does the protocol; this adds the system
/// browser and the loopback listener. The client id is registered once per Gateway and kept in the
/// Keychain.
enum OAuthSignIn {
  static let timeout: TimeInterval = 5 * 60

  /// `appURL` is the Talk app the person typed; its origin is the OAuth `resource`.
  static func run(appURL: URL, cache: ClientIDCache = ClientRegistrationStore()) async throws -> OAuthGrant {
    let server = try LoopbackServer()
    defer { server.stop() }
    let port = try await server.start()
    // RFC 8252 §7.3: the IP literal, not "localhost"; the registered URI has no port.
    let redirectURI = "http://127.0.0.1:\(port)\(LoopbackRedirect.path)"
    return try await SignInFlow(cache: cache).run(appURL: appURL, redirectURI: redirectURI) { url, expectation in
      await MainActor.run { _ = NSWorkspace.shared.open(url) }
      return try await server.waitForCode(expectation, timeout: timeout)
    }
  }
}
