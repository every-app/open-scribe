import Foundation
import TalkCore

/// The smoke and sign-in commands, for agents and the end-to-end lane (no browser clicks, no
/// microphone). Two front doors share this: `talk-smoke` (run with `swift run`) and the app's
/// own binary (`Talk --cli …`). The Keychain commands run inside the signed app binary, so the
/// items they write belong to the app's code identity and the app reads them without a prompt.
///
///   signin <app-url>          the real SignInFlow; prints the authorize URL, waits for the callback
///   status                    who's signed in (host, method, expiry); never prints a token
///   refresh                   one forced refresh, the rotated grant saved at once
///   signout [--keep-copy F]   revoke the refresh token, clear the sign-in; with --keep-copy, first
///                             write the access token to a new 0600 file F, to check it now gets 401
///   token --out F [--refresh-out G]
///                             for negative checks: the current access token (refreshed first if it's
///                             within a minute of expiry) to a new 0600 file F, the refresh token to G;
///                             prints only "ok wrote …", never a token
///   api --keychain            the API smoke with the stored sign-in, including a forced refresh
///   api <app-url> <token>     the API smoke with a pasted token (no Keychain)
///   app-state                 asks the RUNNING app what its menu shows (signed-in host, calendar)
public enum CLI {
  /// Posted after the stored sign-in changes, so a running app reloads it.
  public static let credentialsChanged = Notification.Name("com.everyapp.talk.credentialsChanged")
  /// `app-state`: the CLI asks (object = a nonce), the running app answers (same object, the
  /// state as string userInfo). Counts only, no meeting titles: any local process can ask.
  public static let stateRequest = Notification.Name("com.everyapp.talk.stateRequest")
  public static let stateReply = Notification.Name("com.everyapp.talk.stateReply")

  public static let usage = """
    usage: talk-smoke signin <app-url>
           talk-smoke status | refresh | signout [--keep-copy <file>]
           talk-smoke token --out <file> [--refresh-out <file>]
           talk-smoke <app-url> --keychain
           talk-smoke <app-url> <token>
           talk-smoke app-state
    """

  public static func run(_ args: [String]) async -> Int32 {
    switch args.first {
    case "signin" where args.count == 2: return await signIn(args[1])
    case "status": return status()
    case "app-state": return appState()
    case "refresh": return await refresh()
    case "token": return await token(Array(args.dropFirst()))
    case "signout" where args.count == 1: return await signOut(keepCopy: nil)
    case "signout" where args.count == 3 && args[1] == "--keep-copy": return await signOut(keepCopy: args[2])
    case "api" where args.count == 2 && args[1] == "--keychain": return await keychainSmoke()
    case "api" where args.count == 3:
      guard let url = URL.typed(args[1])?.origin else { return fail("not an app URL: \(args[1])") }
      return await apiSmoke(APIClient(auth: AccessTokenAuthProvider(appURL: url, token: args[2])))
    default:
      say(usage)
      return 2
    }
  }

  // MARK: Sign-in

  static let store = CredentialStore()

  static func signIn(_ text: String) async -> Int32 {
    guard let appURL = URL.typed(text)?.origin else { return fail("not an app URL: \(text)") }
    do {
      let server = try LoopbackServer()
      defer { server.stop() }
      let port = try await server.start()
      let redirectURI = "http://127.0.0.1:\(port)\(LoopbackRedirect.path)"
      let timeout = TimeInterval(ProcessInfo.processInfo.environment["TALK_SIGNIN_TIMEOUT"] ?? "") ?? 600
      let grant = try await SignInFlow(cache: ClientRegistrationStore()).run(appURL: appURL, redirectURI: redirectURI) {
        url, expectation in
        say("Open this URL in a browser and approve:")
        say("AUTHORIZE_URL \(url.absoluteString)")
        say("Waiting on \(redirectURI) (up to \(Int(timeout)) s)…")
        return try await server.waitForCode(expectation, timeout: timeout)
      }
      guard store.save(.oauth(grant)) else { return fail("couldn't write the Keychain") }
      changed()
      say("ok   signed in to \(grant.appURL.host ?? "?") via \(grant.issuer.host ?? "?"); \(describe(grant))")
      return 0
    } catch {
      return fail("sign-in: \(error.localizedDescription)")
    }
  }

  public static let unreadableSentence =
    "a saved sign-in exists, but this build can't read it (it was written by another build signed without a Team ID); sign in again"

  static func status() -> Int32 {
    if store.probe() == .unreadable {
      say("signed out: \(unreadableSentence)")
      return 0
    }
    switch store.load() {
    case nil:
      say("signed out")
    case .accessToken(let url, _)?:
      say("signed in to \(url.host ?? "?") with an access token")
    case .oauth(let grant)?:
      say("signed in to \(grant.appURL.host ?? "?") with Every App (\(grant.issuer.host ?? "?")); \(describe(grant))")
    }
    return 0
  }

  static func refresh() async -> Int32 {
    guard case .oauth(let grant)? = store.load() else { return fail("no Every App sign-in to refresh") }
    do {
      let renewed = try await OAuthClient().refresh(grant)
      // The Gateway rotates refresh tokens: store the new one before anything else.
      guard store.save(.oauth(renewed)) else { return fail("couldn't write the Keychain") }
      ClientRegistrationStore().touch(issuer: renewed.issuer)
      changed()
      let rotated = renewed.refreshToken != grant.refreshToken
      say("ok   refreshed; refresh token \(rotated ? "rotated" : "unchanged"); \(describe(renewed))")
      return 0
    } catch OAuthError.invalidGrant {
      store.delete()
      changed()
      return fail("refresh: invalid_grant, signed out; sign in again")
    } catch {
      return fail("refresh: \(error.localizedDescription)")
    }
  }

  static func signOut(keepCopy: String?) async -> Int32 {
    guard let credentials = store.load() else {
      say("already signed out")
      return 0
    }
    if let keepCopy {
      let token: String
      switch credentials {
      case .accessToken(_, let t): token = t
      case .oauth(let grant): token = grant.accessToken
      }
      guard writeSecret(token, to: keepCopy) else { return fail("couldn't create \(keepCopy) (it must not exist yet)") }
      say("kept a copy of the access token in \(keepCopy) (mode 600); delete it after the check")
    }
    if case .oauth(let grant) = credentials { await OAuthClient().revoke(grant) }
    store.delete()
    changed()
    say("ok   signed out of \(credentials.appURL.host ?? "?")\(credentials.isOAuth ? " (refresh token revoked)" : "")")
    return 0
  }

  // MARK: The running app

  /// Asks the running app for its state and prints it as `key: value` lines, sorted, `menu.N`
  /// lines last in menu order. Exit 1 if no app answers within 5 s.
  static func appState() -> Int32 {
    let nonce = Random.token()
    final class Box: @unchecked Sendable { var reply: [String: String]? }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    // Distributed notifications arrive through a run loop; async top-level code has none, so
    // listen on a thread that runs one.
    let thread = Thread {
      let center = DistributedNotificationCenter.default()
      let observer = center.addObserver(forName: stateReply, object: nonce, queue: nil) { note in
        box.reply = (note.userInfo as? [String: String]) ?? [:]
      }
      center.postNotificationName(stateRequest, object: nonce, userInfo: nil, deliverImmediately: true)
      let deadline = Date().addingTimeInterval(5)
      while box.reply == nil && Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
      }
      center.removeObserver(observer)
      done.signal()
    }
    thread.start()
    done.wait()
    guard let reply = box.reply else { return fail("no running Talk answered (is the app open?)") }
    let menu = reply.keys.filter { $0.hasPrefix("menu.") }.sorted { Int($0.dropFirst(5)) ?? 0 < Int($1.dropFirst(5)) ?? 0 }
    for key in reply.keys.filter({ !$0.hasPrefix("menu.") }).sorted() { say("\(key): \(reply[key]!)") }
    for key in menu { say("\(key): \(reply[key]!)") }
    return 0
  }

  // MARK: API smoke

  static func keychainSmoke() async -> Int32 {
    guard let credentials = store.load() else { return fail("signed out; run signin first") }
    let api: APIClient
    switch credentials {
    case .accessToken(let url, let token):
      api = APIClient(auth: AccessTokenAuthProvider(appURL: url, token: token))
    case .oauth(let grant):
      let provider = OAuthAuthProvider(
        grant: grant, client: OAuthClient(),
        persist: { renewed in
          if let renewed { store.save(.oauth(renewed)) } else { store.delete() }
          changed()
        },
        forgetClient: { ClientRegistrationStore().forget(issuer: $0) },
        touchClient: { ClientRegistrationStore().touch(issuer: $0) })
      api = APIClient(auth: provider)
    }
    var code = await apiSmoke(api)
    guard credentials.isOAuth else { return code }
    // One forced refresh, then the API again on the new token.
    if await refresh() != 0 { code = 1 }
    guard case .oauth(let renewed)? = store.load() else { return 1 }
    let after = APIClient(auth: OAuthAuthProvider(grant: renewed, client: OAuthClient(), persist: { _ in }))
    if await !step("me after refresh", { let me = try await after.me(); return me.email ?? "?" }) { code = 1 }
    return code
  }

  static func apiSmoke(_ api: APIClient) async -> Int32 {
    let appURL = api.appURL
    var failed = false
    failed = !(await step("me") { let me = try await api.me(); return "\(me.email ?? "?") google=\(me.googleConnected)" }) || failed
    failed = !(await step("upcoming") {
      let u = try await api.upcoming()
      return "connected=\(u.connected) events=\(u.events.count) connectURL=\(u.connectURL?.absoluteString ?? "nil")"
    }) || failed
    var meetingID = ""
    failed = !(await step("create") {
      meetingID = try await api.createMeeting(title: "Smoke test", startsAt: Date(), calendarEventId: nil).id
      return meetingID
    }) || failed
    guard !meetingID.isEmpty else { return 1 }
    _ = await step("transcription-token (needs OpenAI set up)") {
      let t = try await api.transcriptionToken(meetingID: meetingID, source: "mic", language: "en")
      return "model=\(t.model ?? "?") expires=\(t.expiresAt)"
    }
    _ = await step("audio-chunk (needs OpenAI set up)") {
      let wav = WAV.encode(pcm16: Data(count: 48 * 1_000))
      let segment = try await api.appendAudioChunk(
        meetingID: meetingID, wav: wav, seq: 100, startedMs: 0, endedMs: 1_000, speaker: .me, language: "en")
      return "segment=\(segment?.text ?? "none")"
    }
    var batcher = SegmentBatcher()
    batcher.add(speaker: .me, startedMs: 0, endedMs: 1_200, text: "Let's start with the roadmap.")
    batcher.add(speaker: .them, startedMs: 1_400, endedMs: 3_000, text: "Sounds good, I have two updates.")
    let batch = batcher.takeBatch()
    failed = !(await step("segments") { try await api.appendSegments(meetingID: meetingID, batch); return "\(batch.count) posted" }) || failed
    failed = !(await step("segments again (dedupe)") { try await api.appendSegments(meetingID: meetingID, batch); return "accepted" }) || failed
    failed = !(await step("finish") { try await api.finish(meetingID: meetingID); return "accepted" }) || failed
    failed = !(await step("meetings") {
      let list = try await api.meetings()
      guard let m = list.first(where: { $0.id == meetingID }) else { throw APIError.decoding("new meeting missing from list") }
      return "\(list.count) total; this one \(m.status ?? "?") → \(m.pageURL(appURL: appURL))"
    }) || failed
    return failed ? 1 : 0
  }

  static func token(_ options: [String]) async -> Int32 {
    var out: String?
    var refreshOut: String?
    var rest = options[...]
    while let flag = rest.popFirst() {
      guard let value = rest.popFirst() else { say(usage); return 2 }
      switch flag {
      case "--out": out = value
      case "--refresh-out": refreshOut = value
      default: say(usage); return 2
      }
    }
    guard let out else { say(usage); return 2 }
    guard var credentials = store.load() else { return fail("signed out; run signin first") }
    // A token about to expire would make a later 401 mean the wrong thing.
    if case .oauth(let grant) = credentials, grant.needsRefresh() {
      do {
        let renewed = try await OAuthClient().refresh(grant)
        guard store.save(.oauth(renewed)) else { return fail("couldn't write the Keychain") }
        ClientRegistrationStore().touch(issuer: renewed.issuer)
        changed()
        credentials = .oauth(renewed)
      } catch {
        return fail("refresh before writing: \(error.localizedDescription)")
      }
    }
    let access: String
    var refresh: String?
    switch credentials {
    case .accessToken(_, let t): access = t
    case .oauth(let grant): (access, refresh) = (grant.accessToken, grant.refreshToken)
    }
    if refreshOut != nil && refresh == nil { return fail("this sign-in has no refresh token") }
    guard writeSecret(access, to: out) else { return fail("couldn't create \(out) (it must not exist yet)") }
    say("ok wrote \(out)")
    if let refreshOut, let refresh {
      guard writeSecret(refresh, to: refreshOut) else { return fail("couldn't create \(refreshOut) (it must not exist yet)") }
      say("ok wrote \(refreshOut)")
    }
    return 0
  }

  /// A new file only (O_EXCL), owner read/write only, for a test that needs the revoked token.
  static func writeSecret(_ secret: String, to path: String) -> Bool {
    let fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    let bytes = Array(secret.utf8)
    return bytes.withUnsafeBufferPointer { write(fd, $0.baseAddress, $0.count) } == bytes.count
  }

  // MARK: Output

  static func step(_ name: String, _ body: () async throws -> String) async -> Bool {
    do {
      say("ok   \(name): \(try await body())")
      return true
    } catch {
      say("FAIL \(name): \(error.localizedDescription)")
      return false
    }
  }

  /// Expiry and scope, never a token.
  static func describe(_ grant: OAuthGrant) -> String {
    let expiry = grant.expiresAt.map { "expires \($0.formatted(.iso8601))" } ?? "no expiry"
    return "\(expiry), scope \(grant.scope ?? "-"), refresh token \(grant.refreshToken == nil ? "none" : "stored")"
  }

  static func changed() {
    DistributedNotificationCenter.default().postNotificationName(CLI.credentialsChanged, object: nil, userInfo: nil, deliverImmediately: true)
  }

  static func say(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
  }

  static func fail(_ line: String) -> Int32 {
    FileHandle.standardError.write(Data(("FAIL " + line + "\n").utf8))
    return 1
  }
}

extension Credentials {
  var isOAuth: Bool {
    if case .oauth = self { return true }
    return false
  }
}
