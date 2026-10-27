import Foundation

/// The browser's request to the RFC 8252 loopback redirect, read from the raw HTTP head.
public enum LoopbackRedirect {
  public static let path = "/callback"

  public enum Outcome: Equatable, Sendable {
    /// The authorization server sent a code and the state matched.
    case code(String)
    /// The authorization server sent `error` (e.g. the person clicked Deny).
    case denied(error: String, description: String?)
    /// Not our callback: a favicon, a stray request, or a forged state. Answer 404 and keep waiting.
    case ignore
    /// Our path, but the state is wrong or the code missing. Stop: something is off.
    case invalid(String)
  }

  /// Parses the request line of `head` (`GET /callback?code=…&state=…&iss=… HTTP/1.1`).
  /// `expectedIssuer` is the Gateway's issuer: an `iss` that differs is refused (RFC 9207, mix-up
  /// defense), and a missing one too when the Gateway said it sends `iss` (`issRequired`).
  public static func parse(head: String, expectedState: String, expectedIssuer: String? = nil, issRequired: Bool = false) -> Outcome {
    guard let line = head.split(whereSeparator: { $0 == "\r" || $0 == "\n" }).first else { return .ignore }
    let parts = line.split(separator: " ")
    guard parts.count >= 2, parts[0] == "GET" else { return .ignore }
    guard let components = URLComponents(string: "http://127.0.0.1" + parts[1]), components.path == path else {
      return .ignore
    }
    var query: [String: String] = [:]
    for item in components.queryItems ?? [] where query[item.name] == nil {
      query[item.name] = item.value ?? ""
    }
    // A response without our state isn't ours, whatever else it says (RFC 6749 §10.12).
    guard let state = query["state"] else { return .invalid("The sign-in response had no state.") }
    guard constantTimeEqual(state, expectedState) else { return .invalid("The sign-in response didn't match this sign-in.") }
    if let expectedIssuer {
      if let iss = query["iss"] {
        let same = URL(string: iss).map(OAuthClient.normalized) == URL(string: expectedIssuer).map(OAuthClient.normalized)
        guard same else { return .invalid("The sign-in response came from a different server.") }
      } else if issRequired {
        return .invalid("The sign-in response didn't say which server sent it.")
      }
    }
    if let error = query["error"] {
      return .denied(error: error, description: query["error_description"])
    }
    guard let code = query["code"], !code.isEmpty else { return .invalid("The sign-in response had no code.") }
    return .code(code)
  }

  /// Whether `head` holds a whole request head yet.
  public static func isComplete(_ head: Data) -> Bool {
    head.range(of: Data("\r\n\r\n".utf8)) != nil || head.range(of: Data("\n\n".utf8)) != nil
  }

  public static func response(status: Int, title: String, message: String) -> Data {
    let reason = status == 200 ? "OK" : status == 404 ? "Not Found" : "Bad Request"
    let body = """
      <!doctype html><html><head><meta charset="utf-8"><title>\(escape(title))</title>
      <style>body{font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#222}
      @media (prefers-color-scheme:dark){body{background:#1e1e1e;color:#ddd}}</style></head>
      <body><div><h2>\(escape(title))</h2><p>\(escape(message))</p></div></body></html>
      """
    let bytes = Data(body.utf8)
    var head = "HTTP/1.1 \(status) \(reason)\r\n"
    head += "Content-Type: text/html; charset=utf-8\r\nContent-Length: \(bytes.count)\r\n"
    head += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
    return Data(head.utf8) + bytes
  }

  static func escape(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
  }

  static func constantTimeEqual(_ a: String, _ b: String) -> Bool {
    let x = Array(a.utf8), y = Array(b.utf8)
    guard x.count == y.count else { return false }
    var diff: UInt8 = 0
    for i in 0..<x.count { diff |= x[i] ^ y[i] }
    return diff == 0
  }
}
