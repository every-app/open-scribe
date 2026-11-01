import Foundation
import Security

/// The sign-in, kept as one generic-password item in the login keychain.
///
/// macOS binds a login-keychain item to its creator's partition: `teamid:<TEAM>` for a Developer ID
/// signature, but the binary's cdhash for a signature without a Team ID (a self-signed dev cert).
/// So a dev rebuild can't read what the last build wrote; `probe()` reports that as `unreadable`
/// rather than "signed out", and reads never raise a Keychain password prompt.
public struct CredentialStore: Sendable {
  /// `TALK_KEYCHAIN_SERVICE` moves everything to another service name (tests, experiments).
  public static let service = ProcessInfo.processInfo.environment["TALK_KEYCHAIN_SERVICE"] ?? "com.everyapp.talk"
  let service: String
  let account: String

  public init(service: String = CredentialStore.service, account: String = "credentials") {
    self.service = service
    self.account = account
  }

  public enum Probe: Equatable {
    case missing
    case readable(Credentials)
    /// An item is there, but this build may not read it (another build's partition).
    case unreadable
  }

  public func probe() -> Probe {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    // Never a password prompt: a launch must not block on one.
    query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data {
      guard let credentials = try? JSONDecoder().decode(Credentials.self, from: data) else { return .unreadable }
      return .readable(credentials)
    }
    return attributesExist ? .unreadable : .missing
  }

  public func load() -> Credentials? {
    if case .readable(let credentials) = probe() { return credentials }
    return nil
  }

  /// Whether an item with our service and account exists, data aside.
  var attributesExist: Bool {
    var query = baseQuery
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    var result: CFTypeRef?
    return SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess
  }

  @discardableResult
  public func save(_ credentials: Credentials) -> Bool {
    guard let data = try? JSONEncoder().encode(credentials) else { return false }
    let update = [kSecValueData as String: data]
    var status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var add = baseQuery
      add[kSecValueData as String] = data
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
      add[kSecAttrLabel as String] = "Talk sign-in"
      status = SecItemAdd(add as CFDictionary, nil)
    }
    return status == errSecSuccess
  }

  public func delete() {
    SecItemDelete(baseQuery as CFDictionary)
  }

  var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }
}

/// The client id this install registered with each Gateway, so it registers once (the design's
/// §13), with when it was last used. Keyed by the Gateway's issuer.
public struct ClientRegistrationStore: Sendable {
  let service: String

  public init(service: String = CredentialStore.service) { self.service = service }

  struct Entry: Codable {
    var clientID: String
    var lastUsed: Date
  }

  public func entry(issuer: URL) -> (clientID: String, lastUsed: Date)? {
    var query = baseQuery(issuer)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    guard let entry = try? JSONDecoder().decode(Entry.self, from: data) else { return nil }
    return (entry.clientID, entry.lastUsed)
  }

  public func save(_ clientID: String, issuer: URL, lastUsed: Date) {
    guard let data = try? JSONEncoder().encode(Entry(clientID: clientID, lastUsed: lastUsed)) else { return }
    forget(issuer: issuer)
    var add = baseQuery(issuer)
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    add[kSecAttrLabel as String] = "Talk client registration"
    SecItemAdd(add as CFDictionary, nil)
  }

  public func forget(issuer: URL) {
    SecItemDelete(baseQuery(issuer) as CFDictionary)
  }

  func baseQuery(_ issuer: URL) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "client:" + OAuthClient.normalized(issuer),
    ]
  }
}
