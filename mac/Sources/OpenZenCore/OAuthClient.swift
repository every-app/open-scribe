import Foundation

/// RFC 8414 authorization server metadata, the fields a public native client uses.
public struct AuthorizationServerMetadata: Codable, Equatable, Sendable {
  public var issuer: URL
  public var authorizationEndpoint: URL
  public var tokenEndpoint: URL
  public var registrationEndpoint: URL?
  public var revocationEndpoint: URL?
  public var codeChallengeMethodsSupported: [String]?
  public var scopesSupported: [String]?

  enum CodingKeys: String, CodingKey {
    case issuer
    case authorizationEndpoint = "authorization_endpoint"
    case tokenEndpoint = "token_endpoint"
    case registrationEndpoint = "registration_endpoint"
    case revocationEndpoint = "revocation_endpoint"
    case codeChallengeMethodsSupported = "code_challenge_methods_supported"
    case scopesSupported = "scopes_supported"
  }
}

public enum OAuthError: Error, LocalizedError, Equatable {
  case discoveryFailed(String)
  case registrationFailed(String)
  /// The refresh token or code was refused (`invalid_grant`): the grant is over.
  case invalidGrant
  case tokenFailed(String)
  case noPKCE

  public var errorDescription: String? {
    switch self {
    case .discoveryFailed(let m): "Couldn't find Every App sign-in at that address. \(m)"
    case .registrationFailed(let m): "The Gateway wouldn't register OpenZen. \(m)"
    case .invalidGrant: "The Gateway ended this sign-in. Sign in again."
    case .tokenFailed(let m): "The Gateway didn't issue a token. \(m)"
    case .noPKCE: "The Gateway doesn't support PKCE (S256), which OpenZen needs."
    }
  }
}

/// The client half of "Sign in with Every App": OAuth 2.0 for a public native client.
/// Discovery (RFC 8414), dynamic registration (RFC 7591), authorization code with PKCE S256
/// (RFC 7636) to a loopback redirect (RFC 8252), resource indicators (RFC 8707), refresh.
/// The browser and the loopback listener are the caller's; this is only the HTTP.
public struct OAuthClient: Sendable {
  public static let clientName = "OpenZen for Mac"

  let transport: HTTPTransport

  public init(transport: HTTPTransport = URLSessionTransport()) { self.transport = transport }

  /// RFC 8414 §3.1: the well-known segment goes between the host and the issuer's path.
  public static func metadataURLs(for issuer: URL) -> [URL] {
    guard let origin = issuer.origin else { return [] }
    var path = URLComponents(url: issuer, resolvingAgainstBaseURL: false)?.path ?? ""
    while path.hasSuffix("/") { path.removeLast() }
    return [
      URL(string: origin.absoluteString + "/.well-known/oauth-authorization-server" + path)!,
      URL(string: origin.absoluteString + "/.well-known/openid-configuration" + path)!,
    ]
  }

  public func discover(issuer: URL) async throws -> AuthorizationServerMetadata {
    var lastProblem = "No metadata."
    for url in Self.metadataURLs(for: issuer) {
      var request = URLRequest(url: url)
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      do {
        let (data, response) = try await transport.send(request)
        guard response.statusCode == 200 else {
          lastProblem = "HTTP \(response.statusCode) from \(url.path)."
          continue
        }
        let metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: data)
        if let methods = metadata.codeChallengeMethodsSupported, !methods.contains("S256") { throw OAuthError.noPKCE }
        return metadata
      } catch let error as OAuthError {
        throw error
      } catch {
        lastProblem = error.localizedDescription
      }
    }
    throw OAuthError.discoveryFailed(lastProblem)
  }

  /// Registers a public client. Pass the port-less loopback URI (which RFC 8252 §7.3 servers
  /// match on any port) and this sign-in's exact one (for servers that compare exactly).
  public func register(at endpoint: URL, redirectURIs: [String], scope: String?) async throws -> String {
    var body: [String: Any] = [
      "client_name": Self.clientName,
      "redirect_uris": redirectURIs,
      "grant_types": ["authorization_code", "refresh_token"],
      "response_types": ["code"],
      "token_endpoint_auth_method": "none",
      "application_type": "native",
    ]
    if let scope { body["scope"] = scope }
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
    metadata: AuthorizationServerMetadata, clientID: String, redirectURI: String, pkce: PKCE, state: String,
    resource: String, scope: String?
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
    if let scope { items.append(URLQueryItem(name: "scope", value: scope)) }
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
      metadata.tokenEndpoint,
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

  public func refresh(_ grant: OAuthGrant, now: Date = Date()) async throws -> OAuthGrant {
    guard let refreshToken = grant.refreshToken else { throw OAuthError.invalidGrant }
    let token = try await tokenRequest(
      grant.tokenEndpoint,
      [
        ("grant_type", "refresh_token"),
        ("refresh_token", refreshToken),
        ("client_id", grant.clientID),
        ("resource", grant.resource),
      ])
    var renewed = grant
    renewed.accessToken = token.accessToken
    // Servers that rotate refresh tokens send a new one; the rest keep the old one valid.
    renewed.refreshToken = token.refreshToken ?? refreshToken
    renewed.expiresAt = token.expiresIn.map { now.addingTimeInterval(TimeInterval($0)) }
    renewed.scope = token.scope ?? grant.scope
    return renewed
  }

  /// RFC 7009, best effort: signing out works even if this fails.
  public func revoke(_ grant: OAuthGrant) async {
    guard let endpoint = grant.revocationEndpoint else { return }
    for (token, hint) in [(grant.refreshToken, "refresh_token"), (grant.accessToken, "access_token")] {
      guard let token else { continue }
      var request = URLRequest(url: endpoint)
      request.httpMethod = "POST"
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      request.httpBody = FormEncoding.encode([("token", token), ("token_type_hint", hint), ("client_id", grant.clientID)])
      _ = try? await transport.send(request)
    }
  }

  struct TokenResponse: Decodable {
    var accessToken: String
    var tokenType: String?
    var expiresIn: Int?
    var refreshToken: String?
    var scope: String?

    enum CodingKeys: String, CodingKey {
      case accessToken = "access_token"
      case tokenType = "token_type"
      case expiresIn = "expires_in"
      case refreshToken = "refresh_token"
      case scope
    }
  }

  private func tokenRequest(_ endpoint: URL, _ fields: [(String, String)]) async throws -> TokenResponse {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = FormEncoding.encode(fields)
    let (data, response) = try await transport.send(request)
    if response.statusCode == 400 || response.statusCode == 401,
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      json["error"] as? String == "invalid_grant"
    {
      throw OAuthError.invalidGrant
    }
    guard response.statusCode == 200 else { throw OAuthError.tokenFailed(Self.problem(data, status: response.statusCode)) }
    do {
      let token = try JSONDecoder().decode(TokenResponse.self, from: data)
      if let type = token.tokenType, type.lowercased() != "bearer" {
        throw OAuthError.tokenFailed("Unexpected token type \(type).")
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
