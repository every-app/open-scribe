import Foundation
import Security

/// The sign-in, kept as one generic-password item in the login keychain.
public struct CredentialStore: Sendable {
  public static let service = "com.everyapp.openzen"
  let service: String
  let account: String

  public init(service: String = CredentialStore.service, account: String = "credentials") {
    self.service = service
    self.account = account
  }

  public func load() -> Credentials? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return try? JSONDecoder().decode(Credentials.self, from: data)
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
      add[kSecAttrLabel as String] = "OpenZen sign-in"
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
    add[kSecAttrLabel as String] = "OpenZen client registration"
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
