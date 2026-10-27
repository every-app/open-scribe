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
