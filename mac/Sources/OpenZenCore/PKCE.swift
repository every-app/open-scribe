import CryptoKit
import Foundation

/// RFC 7636 proof key, S256 only.
public struct PKCE: Sendable, Equatable {
  public let verifier: String
  public let challenge: String
  public var method: String { "S256" }

  /// A fresh verifier: 32 random bytes, base64url, 43 characters (the RFC's minimum length,
  /// 256 bits of entropy).
  public init() {
    self.init(verifier: Base64URL.encode(Random.bytes(32)))
  }

  public init(verifier: String) {
    self.verifier = verifier
    self.challenge = PKCE.challenge(for: verifier)
  }

  public static func challenge(for verifier: String) -> String {
    Base64URL.encode(Data(SHA256.hash(data: Data(verifier.utf8))))
  }

  /// RFC 7636 §4.1: 43–128 characters from [A-Z a-z 0-9 - . _ ~].
  public static func isValidVerifier(_ verifier: String) -> Bool {
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    return (43...128).contains(verifier.count) && verifier.unicodeScalars.allSatisfy(allowed.contains)
  }
}

public enum Base64URL {
  public static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

public enum Random {
  public static func bytes(_ count: Int) -> Data {
    var data = Data(count: count)
    let status = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
    precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
    return data
  }

  /// An opaque URL-safe token, for `state`.
  public static func token(bytes: Int = 16) -> String { Base64URL.encode(Random.bytes(bytes)) }
}
