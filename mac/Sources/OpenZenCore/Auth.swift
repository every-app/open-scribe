import Foundation

/// What the Keychain holds: how this Mac signs in to one OpenZen app.
public enum Credentials: Codable, Equatable, Sendable {
  /// Interim: a personal access token the person made in Manage workspace → Tokens.
  case accessToken(appURL: URL, token: String)
  /// "Sign in with Every App": an OAuth grant from the Gateway.
  case oauth(OAuthGrant)

  public var appURL: URL {
    switch self {
    case .accessToken(let url, _): url
    case .oauth(let grant): grant.appURL
    }
  }
}

public struct OAuthGrant: Codable, Equatable, Sendable {
  public var appURL: URL
  public var issuer: URL
  public var tokenEndpoint: URL
  public var revocationEndpoint: URL?
  public var clientID: String
  public var resource: String
  public var accessToken: String
  public var refreshToken: String?
  public var expiresAt: Date?
  public var scope: String?

  public init(
    appURL: URL, issuer: URL, tokenEndpoint: URL, revocationEndpoint: URL?, clientID: String, resource: String,
    accessToken: String, refreshToken: String?, expiresAt: Date?, scope: String?
  ) {
    self.appURL = appURL
    self.issuer = issuer
    self.tokenEndpoint = tokenEndpoint
    self.revocationEndpoint = revocationEndpoint
    self.clientID = clientID
    self.resource = resource
    self.accessToken = accessToken
    self.refreshToken = refreshToken
    self.expiresAt = expiresAt
    self.scope = scope
  }

  /// Refresh a minute early, so a token never expires mid-request.
  public func needsRefresh(now: Date = Date()) -> Bool {
    guard let expiresAt else { return false }
    return expiresAt.timeIntervalSince(now) < 60
  }
}

public enum AuthError: Error, LocalizedError, Equatable {
  /// The token is gone, expired or revoked and can't be renewed: sign in again.
  case signedOut
  case message(String)

  public var errorDescription: String? {
    switch self {
    case .signedOut: "You're signed out. Sign in again."
    case .message(let m): m
    }
  }
}

/// Hands the API client a bearer token, whatever kind of sign-in made it.
public protocol AuthProvider: Sendable {
  var appURL: URL { get }
  /// A token good for at least the next minute.
  func accessToken() async throws -> String
  /// The server refused `token` with 401: renew if possible, else throw `.signedOut`.
  func tokenRejected(_ token: String) async throws -> String
}

/// The interim sign-in: a pasted personal access token. Nothing to renew.
public struct AccessTokenAuthProvider: AuthProvider {
  public let appURL: URL
  let token: String

  public init(appURL: URL, token: String) {
    self.appURL = appURL
    self.token = token
  }

  public func accessToken() async throws -> String { token }
  public func tokenRejected(_ token: String) async throws -> String { throw AuthError.signedOut }
}

/// OAuth: refreshes with the refresh token when the access token is near expiry or refused,
/// and writes the renewed grant back through `persist`.
public actor OAuthAuthProvider: AuthProvider {
  public nonisolated let appURL: URL
  var grant: OAuthGrant
  let client: OAuthClient
  let persist: @Sendable (OAuthGrant?) -> Void
  var refreshing: Task<OAuthGrant, Error>?

  public init(grant: OAuthGrant, client: OAuthClient, persist: @escaping @Sendable (OAuthGrant?) -> Void) {
    self.appURL = grant.appURL
    self.grant = grant
    self.client = client
    self.persist = persist
  }

  public func accessToken() async throws -> String {
    if grant.needsRefresh() { return try await refresh().accessToken }
    return grant.accessToken
  }

  public func tokenRejected(_ token: String) async throws -> String {
    // Another request may have renewed it already.
    if token != grant.accessToken { return grant.accessToken }
    return try await refresh().accessToken
  }

  private func refresh() async throws -> OAuthGrant {
    if let refreshing { return try await refreshing.value }
    guard grant.refreshToken != nil else {
      persist(nil)
      throw AuthError.signedOut
    }
    let current = grant
    let task = Task { try await client.refresh(current) }
    refreshing = task
    defer { refreshing = nil }
    do {
      let renewed = try await task.value
      grant = renewed
      persist(renewed)
      return renewed
    } catch OAuthError.invalidGrant {
      persist(nil)
      throw AuthError.signedOut
    }
  }
}
