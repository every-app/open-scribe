import Foundation
import Testing

@testable import OpenZenCore

@Suite struct PKCETests {
  @Test func rfc7636AppendixBVector() {
    let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    #expect(pkce.method == "S256")
  }

  @Test func freshVerifierIsValidAndUnique() {
    let a = PKCE(), b = PKCE()
    #expect(PKCE.isValidVerifier(a.verifier))
    #expect(a.verifier.count == 43)
    #expect(a.verifier != b.verifier)
    #expect(!a.challenge.contains("="))
    #expect(!a.challenge.contains("+"))
    #expect(!a.challenge.contains("/"))
  }

  @Test func verifierValidation() {
    #expect(!PKCE.isValidVerifier(String(repeating: "a", count: 42)))
    #expect(PKCE.isValidVerifier(String(repeating: "a", count: 128)))
    #expect(!PKCE.isValidVerifier(String(repeating: "a", count: 129)))
    #expect(!PKCE.isValidVerifier(String(repeating: "a", count: 42) + "+"))
  }
}

@Suite struct LoopbackRedirectTests {
  let state = "s7aTe-123"

  @Test func code() {
    let head = "GET /callback?code=abc%2F123&state=s7aTe-123 HTTP/1.1\r\nHost: 127.0.0.1:53111\r\n\r\n"
    #expect(LoopbackRedirect.parse(head: head, expectedState: state) == .code("abc/123"))
  }

  @Test func denied() {
    let head = "GET /callback?error=access_denied&error_description=User%20said%20no&state=s7aTe-123 HTTP/1.1\r\n\r\n"
    #expect(LoopbackRedirect.parse(head: head, expectedState: state) == .denied(error: "access_denied", description: "User said no"))
  }

  @Test func wrongStateIsInvalid() {
    let head = "GET /callback?code=abc&state=other HTTP/1.1\r\n\r\n"
    guard case .invalid = LoopbackRedirect.parse(head: head, expectedState: state) else {
      Issue.record("expected invalid")
      return
    }
  }

  @Test func missingStateIsInvalid() {
    guard case .invalid = LoopbackRedirect.parse(head: "GET /callback?code=abc HTTP/1.1\r\n\r\n", expectedState: state) else {
      Issue.record("expected invalid")
      return
    }
  }

  @Test func deniedWithWrongStateIsInvalid() {
    let head = "GET /callback?error=access_denied&state=nope HTTP/1.1\r\n\r\n"
    guard case .invalid = LoopbackRedirect.parse(head: head, expectedState: state) else {
      Issue.record("expected invalid")
      return
    }
  }

  @Test func missingCodeIsInvalid() {
    guard case .invalid = LoopbackRedirect.parse(head: "GET /callback?state=s7aTe-123 HTTP/1.1\r\n\r\n", expectedState: state) else {
      Issue.record("expected invalid")
      return
    }
  }

  @Test func otherRequestsAreIgnored() {
    #expect(LoopbackRedirect.parse(head: "GET /favicon.ico HTTP/1.1\r\n\r\n", expectedState: state) == .ignore)
    #expect(LoopbackRedirect.parse(head: "POST /callback?code=a&state=s7aTe-123 HTTP/1.1\r\n\r\n", expectedState: state) == .ignore)
    #expect(LoopbackRedirect.parse(head: "", expectedState: state) == .ignore)
    #expect(LoopbackRedirect.parse(head: "garbage", expectedState: state) == .ignore)
    #expect(LoopbackRedirect.parse(head: "GET /callbackx?code=a&state=s7aTe-123 HTTP/1.1\r\n\r\n", expectedState: state) == .ignore)
  }

  @Test func firstValueWinsForRepeatedParameters() {
    let head = "GET /callback?code=first&code=second&state=s7aTe-123 HTTP/1.1\r\n\r\n"
    #expect(LoopbackRedirect.parse(head: head, expectedState: state) == .code("first"))
  }

  @Test func headCompleteness() {
    #expect(!LoopbackRedirect.isComplete(Data("GET /callback HTTP/1.1\r\nHost: x\r\n".utf8)))
    #expect(LoopbackRedirect.isComplete(Data("GET /callback HTTP/1.1\r\nHost: x\r\n\r\n".utf8)))
  }

  @Test func responseIsWellFormed() {
    let text = String(decoding: LoopbackRedirect.response(status: 200, title: "<Hi>", message: "a&b"), as: UTF8.self)
    #expect(text.hasPrefix("HTTP/1.1 200 OK\r\n"))
    #expect(text.contains("&lt;Hi&gt;"))
    #expect(text.contains("a&amp;b"))
    let parts = text.components(separatedBy: "\r\n\r\n")
    let length = Int(parts[0].components(separatedBy: "Content-Length: ")[1].components(separatedBy: "\r\n")[0])!
    #expect(length == parts[1].utf8.count)
  }
}

/// Answers requests from a table, and records them.
final class StubTransport: HTTPTransport, @unchecked Sendable {
  typealias Handler = (URLRequest) -> (Int, String, [String: String])
  private let lock = NSLock()
  private var handler: Handler
  private(set) var requests: [URLRequest] = []

  init(_ handler: @escaping Handler) { self.handler = handler }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (status, body, headers) = lock.withLock {
      requests.append(request)
      return handler(request)
    }
    var allHeaders = ["Content-Type": "application/json"]
    allHeaders.merge(headers) { $1 }
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: allHeaders)!
    return (Data(body.utf8), response)
  }

  func form(_ request: URLRequest) -> [String: String] {
    let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
    var out: [String: String] = [:]
    for pair in body.split(separator: "&") {
      let kv = pair.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding! }
      out[kv[0]] = kv.count > 1 ? kv[1] : ""
    }
    return out
  }
}

@Suite struct OAuthClientTests {
  static let metadataJSON = """
    {"issuer":"https://gw.example.com","authorization_endpoint":"https://gw.example.com/oauth/authorize",
     "token_endpoint":"https://gw.example.com/oauth/token","registration_endpoint":"https://gw.example.com/oauth/register",
     "revocation_endpoint":"https://gw.example.com/oauth/revoke","code_challenge_methods_supported":["S256"]}
    """

  @Test func metadataURLsFollowRFC8414() {
    #expect(
      OAuthClient.metadataURLs(for: URL(string: "https://gw.example.com")!).map(\.absoluteString) == [
        "https://gw.example.com/.well-known/oauth-authorization-server",
        "https://gw.example.com/.well-known/openid-configuration",
      ])
    #expect(
      OAuthClient.metadataURLs(for: URL(string: "https://gw.example.com/tenant/")!).first?.absoluteString
        == "https://gw.example.com/.well-known/oauth-authorization-server/tenant")
  }

  @Test func discoveryFallsBackToOpenIDConfiguration() async throws {
    let stub = StubTransport { request in
      request.url!.path.contains("oauth-authorization-server") ? (404, "", [:]) : (200, Self.metadataJSON, [:])
    }
    let metadata = try await OAuthClient(transport: stub).discover(issuer: URL(string: "https://gw.example.com")!)
    #expect(metadata.tokenEndpoint.absoluteString == "https://gw.example.com/oauth/token")
    #expect(stub.requests.count == 2)
  }

  @Test func discoveryRefusesServersWithoutS256() async {
    let json = Self.metadataJSON.replacingOccurrences(of: "[\"S256\"]", with: "[\"plain\"]")
    let stub = StubTransport { _ in (200, json, [:]) }
    await #expect(throws: OAuthError.noPKCE) {
      try await OAuthClient(transport: stub).discover(issuer: URL(string: "https://gw.example.com")!)
    }
  }

  @Test func registrationIsAPublicNativeClient() async throws {
    let stub = StubTransport { _ in (201, #"{"client_id":"c-123"}"#, [:]) }
    let id = try await OAuthClient(transport: stub).register(
      at: URL(string: "https://gw.example.com/oauth/register")!,
      redirectURIs: ["http://127.0.0.1/callback", "http://127.0.0.1:5000/callback"], scope: "app:open-zen")
    #expect(id == "c-123")
    let body = try JSONSerialization.jsonObject(with: stub.requests[0].httpBody!) as! [String: Any]
    #expect(body["token_endpoint_auth_method"] as? String == "none")
    #expect(body["redirect_uris"] as? [String] == ["http://127.0.0.1/callback", "http://127.0.0.1:5000/callback"])
    #expect(body["scope"] as? String == "app:open-zen")
    #expect(body["grant_types"] as? [String] == ["authorization_code", "refresh_token"])
  }

  @Test func authorizationURLCarriesPKCEStateAndResource() throws {
    let metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: Data(Self.metadataJSON.utf8))
    let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    let url = OAuthClient.authorizationURL(
      metadata: metadata, clientID: "c-1", redirectURI: "http://127.0.0.1:5000/callback", pkce: pkce, state: "st",
      resource: "https://openzen.example.com", scope: nil)
    let items = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
    #expect(items["response_type"] == "code")
    #expect(items["code_challenge"] == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    #expect(items["code_challenge_method"] == "S256")
    #expect(items["state"] == "st")
    #expect(items["resource"] == "https://openzen.example.com")
    #expect(items["redirect_uri"] == "http://127.0.0.1:5000/callback")
    #expect(items["scope"] == nil)
  }

  @Test func exchangeAndRefresh() async throws {
    let metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: Data(Self.metadataJSON.utf8))
    var refreshCount = 0
    let stub = StubTransport { request in
      let body = String(decoding: request.httpBody!, as: UTF8.self)
      if body.contains("grant_type=authorization_code") {
        return (200, #"{"access_token":"at1","token_type":"Bearer","expires_in":3600,"refresh_token":"rt1"}"#, [:])
      }
      refreshCount += 1
      // The second refresh doesn't rotate the refresh token.
      return refreshCount == 1
        ? (200, #"{"access_token":"at2","token_type":"bearer","expires_in":3600,"refresh_token":"rt2"}"#, [:])
        : (200, #"{"access_token":"at3","token_type":"bearer","expires_in":30}"#, [:])
    }
    let client = OAuthClient(transport: stub)
    let now = Date(timeIntervalSince1970: 1_000_000)
    let pkce = PKCE()
    let grant = try await client.exchange(
      code: "code1", metadata: metadata, clientID: "c-1", redirectURI: "http://127.0.0.1:5000/callback", pkce: pkce,
      resource: "https://openzen.example.com", appURL: URL(string: "https://openzen.example.com")!, now: now)
    #expect(grant.accessToken == "at1")
    #expect(grant.refreshToken == "rt1")
    #expect(grant.expiresAt == now.addingTimeInterval(3600))
    let form = stub.form(stub.requests[0])
    #expect(form["code_verifier"] == pkce.verifier)
    #expect(form["resource"] == "https://openzen.example.com")
    #expect(form["client_id"] == "c-1")

    let renewed = try await client.refresh(grant, now: now)
    #expect(renewed.accessToken == "at2")
    #expect(renewed.refreshToken == "rt2")
    #expect(stub.form(stub.requests[1])["refresh_token"] == "rt1")
    let again = try await client.refresh(renewed, now: now)
    #expect(again.refreshToken == "rt2")
    #expect(again.needsRefresh(now: now))
  }

  @Test func invalidGrantIsDistinct() async throws {
    let stub = StubTransport { _ in (400, #"{"error":"invalid_grant"}"#, [:]) }
    let grant = OAuthGrant(
      appURL: URL(string: "https://a.example.com")!, issuer: URL(string: "https://gw.example.com")!,
      tokenEndpoint: URL(string: "https://gw.example.com/t")!, revocationEndpoint: nil, clientID: "c", resource: "https://a.example.com",
      accessToken: "x", refreshToken: "r", expiresAt: nil, scope: nil)
    await #expect(throws: OAuthError.invalidGrant) { try await OAuthClient(transport: stub).refresh(grant) }
  }

  @Test func providerRenewsOnRejectionAndPersists() async throws {
    let stub = StubTransport { _ in (200, #"{"access_token":"new","expires_in":3600}"#, [:]) }
    let grant = OAuthGrant(
      appURL: URL(string: "https://a.example.com")!, issuer: URL(string: "https://gw.example.com")!,
      tokenEndpoint: URL(string: "https://gw.example.com/t")!, revocationEndpoint: nil, clientID: "c", resource: "https://a.example.com",
      accessToken: "old", refreshToken: "r", expiresAt: Date().addingTimeInterval(3600), scope: nil)
    let saved = Saved()
    let provider = OAuthAuthProvider(grant: grant, client: OAuthClient(transport: stub)) { saved.set($0) }
    #expect(try await provider.accessToken() == "old")
    #expect(try await provider.tokenRejected("old") == "new")
    #expect(saved.get()?.accessToken == "new")
    #expect(saved.get()?.refreshToken == "r")
  }

  final class Saved: @unchecked Sendable {
    private let lock = NSLock()
    private var grant: OAuthGrant?
    func set(_ g: OAuthGrant?) { lock.withLock { grant = g } }
    func get() -> OAuthGrant? { lock.withLock { grant } }
  }

  @Test func credentialsRoundTrip() throws {
    let creds = Credentials.accessToken(appURL: URL(string: "https://openzen.example.com")!, token: "epat_x")
    let data = try JSONEncoder().encode(creds)
    #expect(try JSONDecoder().decode(Credentials.self, from: data) == creds)
  }

  @Test func typedURLs() {
    #expect(URL.typed("openzen.example.com")?.absoluteString == "https://openzen.example.com")
    #expect(URL.typed("https://openzen.example.com/meetings")?.origin?.absoluteString == "https://openzen.example.com")
    #expect(URL.typed("http://evil.example.com") == nil)
    #expect(URL.typed("http://localhost:3000")?.origin?.absoluteString == "http://localhost:3000")
    #expect(URL.typed("  ") == nil)
  }
}
