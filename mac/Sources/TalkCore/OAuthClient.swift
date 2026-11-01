import Foundation

/// RFC 9728 protected resource metadata: which authorization server guards the app.
public struct ProtectedResourceMetadata: Codable, Equatable, Sendable {
  public var resource: String
  public var authorizationServers: [URL]

  enum CodingKeys: String, CodingKey {
    case resource
    case authorizationServers = "authorization_servers"
  }
}

/// RFC 8414 authorization server metadata, the fields a public native client uses.
public struct AuthorizationServerMetadata: Codable, Equatable, Sendable {
  public var issuer: URL
  public var authorizationEndpoint: URL
  public var tokenEndpoint: URL
  public var registrationEndpoint: URL?
  public var revocationEndpoint: URL?
  public var codeChallengeMethodsSupported: [String]?
  /// RFC 9207: the callback carries `iss`.
  public var authorizationResponseIssParameterSupported: Bool?

  enum CodingKeys: String, CodingKey {
    case issuer
    case authorizationEndpoint = "authorization_endpoint"
    case tokenEndpoint = "token_endpoint"
    case registrationEndpoint = "registration_endpoint"
    case revocationEndpoint = "revocation_endpoint"
    case codeChallengeMethodsSupported = "code_challenge_methods_supported"
    case authorizationResponseIssParameterSupported = "authorization_response_iss_parameter_supported"
  }
}

public enum OAuthError: Error, LocalizedError, Equatable {
  case discoveryFailed(String)
  case registrationFailed(String)
  /// The refresh token or code was refused (`invalid_grant`): the grant is over.
  case invalidGrant
  /// The server doesn't know our client id (`invalid_client`): register again.
  case invalidClient
  case tokenFailed(String)
  case noPKCE

  public var errorDescription: String? {
    switch self {
    case .discoveryFailed(let m): "Couldn't find Every App sign-in for that app. \(m)"
    case .registrationFailed(let m): "The Gateway wouldn't register Talk. \(m)"
    case .invalidGrant: "The Gateway ended this sign-in. Sign in again."
    case .invalidClient: "The Gateway no longer knows this Mac. Sign in again."
    case .tokenFailed(let m): "The Gateway didn't issue a token. \(m)"
    case .noPKCE: "The Gateway doesn't support PKCE (S256), which Talk needs."
    }
  }
}

/// The client half of "Sign in with Every App" (docs/SPEC.md; the design's §12/§13): OAuth 2.0
/// for a public native client. Protected resource discovery on the app (RFC 9728), then the
/// Gateway's metadata (RFC 8414), dynamic registration once per install (RFC 7591), authorization
/// code with PKCE S256 (RFC 7636) to a loopback redirect (RFC 8252), `resource` on every request
/// (RFC 8707), `iss` on the callback (RFC 9207). No `scope` anywhere: the grant is for the app.
/// The browser and the loopback listener are the caller's; this is only the HTTP.
public struct OAuthClient: Sendable {
  public static let clientName = "Talk"
  /// Registered once; the Gateway matches it on any loopback port (RFC 8252 §7.3).
  public static let registeredRedirectURI = "http://127.0.0.1/callback"

  let transport: HTTPTransport

  public init(transport: HTTPTransport = URLSessionTransport()) { self.transport = transport }

  /// `scheme://host[:port]` with the default port dropped and no trailing slash, for comparing
  /// origins and issuers.
  public static func normalized(_ url: URL) -> String {
    var s = url.absoluteString
    while s.hasSuffix("/") { s.removeLast() }
    guard var c = URLComponents(string: s) else { return s }
    c.scheme = c.scheme?.lowercased()
    c.host = c.host?.lowercased()
    if (c.scheme == "https" && c.port == 443) || (c.scheme == "http" && c.port == 80) { c.port = nil }
    return c.string ?? s
  }

  /// Step 1: the app names its authorization server. `resource` must be the app's origin.
  public func discoverResource(origin: URL) async throws -> ProtectedResourceMetadata {
    let url = URL(string: Self.normalized(origin) + "/.well-known/oauth-protected-resource")!
    let metadata: ProtectedResourceMetadata = try await getJSON(url, what: "the app's sign-in metadata")
    guard let resourceURL = URL(string: metadata.resource), Self.normalized(resourceURL) == Self.normalized(origin) else {
      throw OAuthError.discoveryFailed("The app says it is \(metadata.resource), not \(Self.normalized(origin)).")
    }
    guard !metadata.authorizationServers.isEmpty else { throw OAuthError.discoveryFailed("The app names no Gateway.") }
    return metadata
  }

  /// RFC 8414 §3.1: the well-known segment goes between the host and the issuer's path.
  public static func metadataURL(for issuer: URL) -> URL {
    let origin = issuer.origin ?? issuer
    var path = URLComponents(url: issuer, resolvingAgainstBaseURL: false)?.path ?? ""
    while path.hasSuffix("/") { path.removeLast() }
    return URL(string: normalized(origin) + "/.well-known/oauth-authorization-server" + path)!
  }

  /// Step 2: the Gateway's endpoints. Its `issuer` must be the Gateway the app named.
  public func discover(issuer: URL) async throws -> AuthorizationServerMetadata {
    let metadata: AuthorizationServerMetadata = try await getJSON(Self.metadataURL(for: issuer), what: "the Gateway's metadata")
    guard Self.normalized(metadata.issuer) == Self.normalized(issuer) else {
      throw OAuthError.discoveryFailed("The Gateway calls itself \(metadata.issuer.absoluteString), not \(issuer.absoluteString).")
    }
    if let methods = metadata.codeChallengeMethodsSupported, !methods.contains("S256") { throw OAuthError.noPKCE }
    return metadata
  }

  /// Registers this install as a public client, once per Gateway; the caller caches the id.
  /// TODO(after v1): a Client ID Metadata Document instead of dynamic registration (design §12).
  public func register(at endpoint: URL) async throws -> String {
    let body: [String: Any] = [
      "client_name": Self.clientName,
      "redirect_uris": [Self.registeredRedirectURI],
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code"],
      "token_endpoint_auth_method": "none",
    ]
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await transport.send(request)
    guard (200..<300).contains(response.statusCode),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let clientID = json["client_id"] as? String, !clientID.isEmpty
    else {
      throw OAuthError.registrationFailed(Self.problem(data, status: response.statusCode))
    }
    return clientID
  }

  public static func authorizationURL(
    metadata: AuthorizationServerMetadata, clientID: String, redirectURI: String, pkce: PKCE, state: String, resource: String
  ) -> URL {
    var c = URLComponents(url: metadata.authorizationEndpoint, resolvingAgainstBaseURL: false)!
    var items = c.queryItems ?? []
    items += [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: clientID),
      URLQueryItem(name: "redirect_uri", value: redirectURI),
      URLQueryItem(name: "code_challenge", value: pkce.challenge),
      URLQueryItem(name: "code_challenge_method", value: pkce.method),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "resource", value: resource),
    ]
    c.queryItems = items
    // URLComponents leaves '+' alone, which form decoders read as a space.
    c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    return c.url!
  }

  public func exchange(
    code: String, metadata: AuthorizationServerMetadata, clientID: String, redirectURI: String, pkce: PKCE,
    resource: String, appURL: URL, now: Date = Date()
  ) async throws -> OAuthGrant {
    let token = try await tokenRequest(
      metadata.tokenEndpoint, resource: resource,
      [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirectURI),
        ("client_id", clientID),
        ("code_verifier", pkce.verifier),
        ("resource", resource),
      ])
    return OAuthGrant(
      appURL: appURL, issuer: metadata.issuer, tokenEndpoint: metadata.tokenEndpoint,
      revocationEndpoint: metadata.revocationEndpoint, clientID: clientID, resource: resource,
      accessToken: token.accessToken, refreshToken: token.refreshToken,
      expiresAt: token.expiresIn.map { now.addingTimeInterval(TimeInterval($0)) }, scope: token.scope)
  }

  /// The new refresh token (the Gateway rotates them) replaces the old one in the returned grant;
  /// the caller must store it before using the access token.
  public func refresh(_ grant: OAuthGrant, now: Date = Date()) async throws -> OAuthGrant {
    guard let refreshToken = grant.refreshToken else { throw OAuthError.invalidGrant }
    let token = try await tokenRequest(
      grant.tokenEndpoint, resource: grant.resource,
      [
        ("grant_type", "refresh_token"),
        ("refresh_token", refreshToken),
        ("client_id", grant.clientID),
        ("resource", grant.resource),
      ])
    var renewed = grant
    renewed.accessToken = token.accessToken
    renewed.refreshToken = token.refreshToken ?? refreshToken
    renewed.expiresAt = token.expiresIn.map { now.addingTimeInterval(TimeInterval($0)) }
    renewed.scope = token.scope ?? grant.scope
    return renewed
  }

  /// RFC 7009, best effort: revokes the refresh token (and with it the grant). Signing out works
  /// even if this fails.
  public func revoke(_ grant: OAuthGrant) async {
    guard let endpoint = grant.revocationEndpoint else { return }
    let (token, hint) = grant.refreshToken.map { ($0, "refresh_token") } ?? (grant.accessToken, "access_token")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = FormEncoding.encode([("token", token), ("token_type_hint", hint), ("client_id", grant.clientID)])
    _ = try? await transport.send(request)
  }

  struct TokenResponse: Decodable {
    var accessToken: String
    var tokenType: String?
    var expiresIn: Int?
    var refreshToken: String?
    var scope: String?
    /// The Gateway echoes the resource the token is for.
    var resource: String?

    enum CodingKeys: String, CodingKey {
      case resource
      case accessToken = "access_token"
      case tokenType = "token_type"
      case expiresIn = "expires_in"
      case refreshToken = "refresh_token"
      case scope
    }
  }

  private func getJSON<T: Decodable>(_ url: URL, what: String) async throws -> T {
    var request = URLRequest(url: url)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(request)
    } catch {
      throw OAuthError.discoveryFailed(error.localizedDescription)
    }
    guard response.statusCode == 200 else {
      throw OAuthError.discoveryFailed("HTTP \(response.statusCode) for \(what) at \(url.path).")
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw OAuthError.discoveryFailed("Couldn't read \(what).")
    }
  }

  /// A token for another resource than the one asked for is refused.
  private func tokenRequest(_ endpoint: URL, resource: String, _ fields: [(String, String)]) async throws -> TokenResponse {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = FormEncoding.encode(fields)
    let (data, response) = try await transport.send(request)
    if (400..<500).contains(response.statusCode),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    {
      switch json["error"] as? String {
      case "invalid_grant": throw OAuthError.invalidGrant
      case "invalid_client": throw OAuthError.invalidClient
      default: break
      }
    }
    guard response.statusCode == 200 else { throw OAuthError.tokenFailed(Self.problem(data, status: response.statusCode)) }
    do {
      let token = try JSONDecoder().decode(TokenResponse.self, from: data)
      if let type = token.tokenType, type.lowercased() != "bearer" {
        throw OAuthError.tokenFailed("Unexpected token type \(type).")
      }
      if let echoed = token.resource, let a = URL(string: echoed), let b = URL(string: resource),
        Self.normalized(a) != Self.normalized(b)
      {
        throw OAuthError.tokenFailed("The token is for \(echoed), not \(resource).")
      }
      return token
    } catch let error as OAuthError {
      throw error
    } catch {
      throw OAuthError.tokenFailed("The response wasn't a token.")
    }
  }

  /// The server's own error code and description, never the token or the body at large.
  static func problem(_ data: Data, status: Int) -> String {
    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let error = json["error"] as? String {
      let description = (json["error_description"] as? String).map { ": \($0)" } ?? ""
      return "\(error)\(description)"
    }
    return "HTTP \(status)."
  }
}
