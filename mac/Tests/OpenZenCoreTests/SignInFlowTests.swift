import Foundation
import Testing

@testable import OpenZenCore

final class MemoryCache: ClientIDCache, @unchecked Sendable {
  private let lock = NSLock()
  private var ids: [String: String] = [:]
  func clientID(issuer: URL) -> String? { lock.withLock { ids[OAuthClient.normalized(issuer)] } }
  func save(_ clientID: String, issuer: URL) { lock.withLock { ids[OAuthClient.normalized(issuer)] = clientID } }
  func forget(issuer: URL) { _ = lock.withLock { ids.removeValue(forKey: OAuthClient.normalized(issuer)) } }
}

/// A fake app plus Gateway: protected resource metadata, AS metadata, registration, token.
final class FakeGateway: @unchecked Sendable {
  let lock = NSLock()
  var registrations = 0
  /// Client ids the Gateway knows.
  var known: Set<String> = []
  var lastAuthorizeURL: URL?

  lazy var transport = StubTransport { [unowned self] request in
    let url = request.url!
    switch (url.host!, url.path) {
    case ("open-zen.example.com", "/.well-known/oauth-protected-resource"):
      return (200, #"{"resource":"https://open-zen.example.com","authorization_servers":["https://gw.example.com"]}"#, [:])
    case ("gw.example.com", "/.well-known/oauth-authorization-server"):
      return (200, OAuthClientTests.metadataJSON, [:])
    case ("gw.example.com", "/oauth/register"):
      let id = self.lock.withLock { () -> String in
        self.registrations += 1
        let id = "client-\(self.registrations)"
        self.known.insert(id)
        return id
      }
      return (201, #"{"client_id":"\#(id)"}"#, [:])
    case ("gw.example.com", "/oauth/token"):
      let form = String(decoding: request.httpBody!, as: UTF8.self)
      let id = form.split(separator: "&").first { $0.hasPrefix("client_id=") }.map { String($0.dropFirst(10)) } ?? ""
      guard self.lock.withLock({ self.known.contains(id) }) else { return (401, #"{"error":"invalid_client"}"#, [:]) }
      return (200, #"{"access_token":"at","token_type":"bearer","expires_in":3600,"refresh_token":"rt","scope":"*"}"#, [:])
    default:
      return (404, "", [:])
    }
  }
}

@Suite struct SignInFlowTests {
  let app = URL(string: "https://open-zen.example.com/meetings")!
  let redirect = "http://127.0.0.1:5000/callback"

  func flow(_ gateway: FakeGateway, _ cache: MemoryCache) -> SignInFlow {
    SignInFlow(client: OAuthClient(transport: gateway.transport), cache: cache)
  }

  @Test func discoversRegistersAndCachesTheClient() async throws {
    let gateway = FakeGateway(), cache = MemoryCache()
    let grant = try await flow(gateway, cache).run(appURL: app, redirectURI: redirect) { url, expectation in
      let items = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
      #expect(items["resource"] == "https://open-zen.example.com")
      #expect(items["client_id"] == "client-1")
      #expect(items["scope"] == nil)
      #expect(items["state"] == expectation.state)
      #expect(expectation.issuer == "https://gw.example.com")
      return "code"
    }
    #expect(grant.accessToken == "at")
    #expect(grant.resource == "https://open-zen.example.com")
    #expect(grant.appURL.absoluteString == "https://open-zen.example.com")
    #expect(grant.clientID == "client-1")
    #expect(cache.clientID(issuer: URL(string: "https://gw.example.com")!) == "client-1")
    // The paths it took: the app names the Gateway first.
    let paths = gateway.transport.requests.map { "\($0.url!.host!)\($0.url!.path)" }
    #expect(paths.prefix(2) == ["open-zen.example.com/.well-known/oauth-protected-resource", "gw.example.com/.well-known/oauth-authorization-server"])
  }

  @Test func reusesTheCachedClient() async throws {
    let gateway = FakeGateway(), cache = MemoryCache()
    _ = try await flow(gateway, cache).run(appURL: app, redirectURI: redirect) { _, _ in "code" }
    let second = try await flow(gateway, cache).run(appURL: app, redirectURI: "http://127.0.0.1:6000/callback") { _, _ in "code" }
    #expect(gateway.registrations == 1)
    #expect(second.clientID == "client-1")
  }

  @Test func reRegistersOnInvalidClientFromTheTokenEndpoint() async throws {
    let gateway = FakeGateway(), cache = MemoryCache()
    cache.save("forgotten", issuer: URL(string: "https://gw.example.com")!)
    let grant = try await flow(gateway, cache).run(appURL: app, redirectURI: redirect) { _, _ in "code" }
    #expect(gateway.registrations == 1)
    #expect(grant.clientID == "client-1")
    #expect(cache.clientID(issuer: URL(string: "https://gw.example.com")!) == "client-1")
  }

  @Test func reRegistersOnInvalidClientFromTheCallback() async throws {
    let gateway = FakeGateway(), cache = MemoryCache()
    cache.save("forgotten", issuer: URL(string: "https://gw.example.com")!)
    let grant = try await flow(gateway, cache).run(appURL: app, redirectURI: redirect) { url, _ in
      if url.query!.contains("client_id=forgotten") { throw OAuthError.invalidClient }
      return "code"
    }
    #expect(grant.clientID == "client-1")
  }

  @Test func aFreshClientRefusedIsAnError() async {
    let gateway = FakeGateway(), cache = MemoryCache()
    await #expect(throws: OAuthError.invalidClient) {
      try await flow(gateway, cache).run(appURL: app, redirectURI: redirect) { _, _ in throw OAuthError.invalidClient }
    }
    #expect(gateway.registrations == 1)
  }

  @Test func providerForgetsTheClientOnInvalidClient() async {
    let stub = StubTransport { _ in (401, #"{"error":"invalid_client"}"#, [:]) }
    let grant = OAuthGrant(
      appURL: URL(string: "https://open-zen.example.com")!, issuer: URL(string: "https://gw.example.com")!,
      tokenEndpoint: URL(string: "https://gw.example.com/oauth/token")!, revocationEndpoint: nil, clientID: "c",
      resource: "https://open-zen.example.com", accessToken: "old", refreshToken: "r", expiresAt: Date().addingTimeInterval(3600), scope: nil)
    let cache = MemoryCache()
    cache.save("c", issuer: grant.issuer)
    let provider = OAuthAuthProvider(grant: grant, client: OAuthClient(transport: stub), persist: { _ in }, forgetClient: { cache.forget(issuer: $0) })
    await #expect(throws: AuthError.signedOut) { try await provider.tokenRejected("old") }
    #expect(cache.clientID(issuer: grant.issuer) == nil)
  }

  @Test func signOutRevokesTheRefreshToken() async {
    let stub = StubTransport { _ in (200, "", [:]) }
    let grant = OAuthGrant(
      appURL: URL(string: "https://open-zen.example.com")!, issuer: URL(string: "https://gw.example.com")!,
      tokenEndpoint: URL(string: "https://gw.example.com/oauth/token")!, revocationEndpoint: URL(string: "https://gw.example.com/oauth/revoke")!,
      clientID: "c", resource: "https://open-zen.example.com", accessToken: "at", refreshToken: "rt", expiresAt: nil, scope: nil)
    await OAuthClient(transport: stub).revoke(grant)
    #expect(stub.requests.count == 1)
    let form = stub.form(stub.requests[0])
    #expect(form["token"] == "rt")
    #expect(form["token_type_hint"] == "refresh_token")
    #expect(form["client_id"] == "c")
  }
}
