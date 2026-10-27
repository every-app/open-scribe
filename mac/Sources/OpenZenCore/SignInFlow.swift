import Foundation

/// Where a cached client id lives (the Keychain in the app, memory in tests).
public protocol ClientIDCache: Sendable {
  func clientID(issuer: URL) -> String?
  func save(_ clientID: String, issuer: URL)
  func forget(issuer: URL)
}

extension ClientRegistrationStore: ClientIDCache {}

/// What the loopback callback must carry for this sign-in.
public struct CallbackExpectation: Sendable, Equatable {
  public var state: String
  public var issuer: String
  /// The Gateway said it puts `iss` on the callback, so a callback without it is refused.
  public var issRequired: Bool
}

/// "Sign in with Every App", start to finish, minus the browser and the listener:
/// 1. `GET {app}/.well-known/oauth-protected-resource`: `resource` must be the app's origin;
///    `authorization_servers[0]` is the Gateway.
/// 2. `GET {gateway}/.well-known/oauth-authorization-server`: `issuer` must be the Gateway.
/// 3. The client id registered with that Gateway, from the cache, or registered now and cached.
/// 4. The browser (via `authorize`) with PKCE, `state` and `resource`; the code comes back.
/// 5. The token exchange, with `resource`.
/// A cached client the Gateway no longer knows (`invalid_client`) is forgotten and the sign-in
/// runs once more with a fresh registration.
public struct SignInFlow: Sendable {
  let client: OAuthClient
  let cache: ClientIDCache

  public init(client: OAuthClient = OAuthClient(), cache: ClientIDCache) {
    self.client = client
    self.cache = cache
  }

  /// `redirectURI` is the listener's `http://127.0.0.1:<port>/callback`. `authorize` opens the
  /// authorization URL and returns the code from a callback that meets the expectation; it throws
  /// `OAuthError.invalidClient` if the Gateway answers that.
  public func run(
    appURL: URL, redirectURI: String,
    authorize: @Sendable (URL, CallbackExpectation) async throws -> String
  ) async throws -> OAuthGrant {
    guard let origin = appURL.origin else { throw AuthError.message("That app URL isn't valid.") }
    let resource = OAuthClient.normalized(origin)
    let protected = try await client.discoverResource(origin: origin)
    let issuer = protected.authorizationServers[0]
    let metadata = try await client.discover(issuer: issuer)

    var retried = false
    while true {
      let (clientID, fresh) = try await clientID(metadata: metadata)
      do {
        let pkce = PKCE()
        let expectation = CallbackExpectation(
          state: Random.token(), issuer: metadata.issuer.absoluteString,
          issRequired: metadata.authorizationResponseIssParameterSupported == true)
        let url = OAuthClient.authorizationURL(
          metadata: metadata, clientID: clientID, redirectURI: redirectURI, pkce: pkce, state: expectation.state,
          resource: resource)
        let code = try await authorize(url, expectation)
        return try await client.exchange(
          code: code, metadata: metadata, clientID: clientID, redirectURI: redirectURI, pkce: pkce, resource: resource,
          appURL: origin)
      } catch OAuthError.invalidClient where !fresh && !retried {
        cache.forget(issuer: metadata.issuer)
        retried = true
      }
    }
  }

  private func clientID(metadata: AuthorizationServerMetadata) async throws -> (String, fresh: Bool) {
    if let cached = cache.clientID(issuer: metadata.issuer) { return (cached, false) }
    guard let endpoint = metadata.registrationEndpoint else {
      throw OAuthError.registrationFailed("It doesn't offer dynamic client registration.")
    }
    let id = try await client.register(at: endpoint)
    cache.save(id, issuer: metadata.issuer)
    return (id, true)
  }
}
