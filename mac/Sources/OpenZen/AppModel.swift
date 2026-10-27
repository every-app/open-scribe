import AppKit
import Foundation
import OpenZenCLI
import OpenZenCore

/// The app's state: who's signed in, the calendar, the recorder.
@MainActor
final class AppModel: ObservableObject {
  static let pollInterval: TimeInterval = 5 * 60

  @Published private(set) var credentials: Credentials?
  @Published private(set) var me: Me?
  @Published private(set) var events: [CalendarEvent] = []
  @Published private(set) var calendarConnected = true
  @Published private(set) var connectURL: URL?
  @Published private(set) var calendarError: String?
  @Published private(set) var meetings: [MeetingSummary] = []
  @Published private(set) var meetingsError: String?
  @Published private(set) var loadingMeetings = false
  @Published var signingIn = false
  @Published var signInError: String?

  let recorder = Recorder()
  let reminders = Reminders()
  private let store = CredentialStore()
  private(set) var api: APIClient?
  private var pollTask: Task<Void, Never>?
  private var signInTask: Task<Void, Never>?
  private var wakeObserver: NSObjectProtocol?

  init() {
    reminders.install()
    reminders.onRecord = { [weak self] request in
      self?.record(title: request.title, startsAt: request.start, calendarEventID: request.eventID)
    }
    wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in
      Task { @MainActor in
        // The network takes a moment to come back after wake.
        try? await Task.sleep(for: .seconds(5))
        await self?.refresh()
      }
    }
    // `openzen-smoke signin|refresh|signout` changed the stored sign-in: pick it up.
    credentialsObserver = DistributedNotificationCenter.default().addObserver(
      forName: CLI.credentialsChanged, object: nil, queue: .main
    ) { [weak self] _ in
      Task { @MainActor in self?.reloadCredentials() }
    }
    if let saved = store.load() { use(saved) }
  }

  private var credentialsObserver: NSObjectProtocol?

  /// Re-reads the Keychain after another process (the CLI) changed it.
  func reloadCredentials() {
    let saved = store.load()
    guard saved != credentials else { return }
    if let saved {
      me = nil
      signInError = nil
      use(saved)
    } else {
      credentials = nil
      api = nil
      me = nil
      events = []
      meetings = []
      pollTask?.cancel()
      reminders.removeAll()
    }
  }

  var isSignedIn: Bool { credentials != nil }
  var appURL: URL? { credentials?.appURL }

  // MARK: Sign-in

  func signIn(appURLText: String, token: String) {
    guard let url = URL.typed(appURLText), let origin = url.origin else {
      signInError = "Enter the app's address, like https://open-zen.example.com."
      return
    }
    let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else {
      signInError = "Paste a personal access token."
      return
    }
    let credentials = Credentials.accessToken(appURL: origin, token: token)
    verifyAndSave(credentials)
  }

  /// The person types only the OpenZen app's URL; the app names its Gateway (RFC 9728).
  func signInWithEveryApp(appURLText: String) {
    guard let appURL = URL.typed(appURLText)?.origin else {
      signInError = "Enter the OpenZen app's address, like https://open-zen.example.com."
      return
    }
    signingIn = true
    signInError = nil
    signInTask = Task {
      do {
        let grant = try await OAuthSignIn.run(appURL: appURL)
        verifyAndSave(.oauth(grant))
      } catch is CancellationError {
        signingIn = false
      } catch {
        signingIn = false
        signInError = error.localizedDescription
      }
    }
  }

  func cancelSignIn() {
    signInTask?.cancel()
    signInTask = nil
    signingIn = false
  }

  func signOut() {
    if case .oauth(let grant) = credentials {
      Task { await OAuthClient().revoke(grant) }
    }
    store.delete()
    credentials = nil
    api = nil
    me = nil
    events = []
    meetings = []
    pollTask?.cancel()
    reminders.removeAll()
  }

  private func verifyAndSave(_ credentials: Credentials) {
    signingIn = true
    signInError = nil
    let client = makeClient(credentials)
    Task {
      do {
        let me = try await client.me()
        store.save(credentials)
        use(credentials, client: client)
        self.me = me
        signingIn = false
        Task { _ = await Permissions.requestNotifications() }
      } catch APIError.signedOut {
        signingIn = false
        signInError = "OpenZen didn't accept that token."
      } catch {
        signingIn = false
        signInError = error.localizedDescription
      }
    }
  }

  private func makeClient(_ credentials: Credentials) -> APIClient {
    switch credentials {
    case .accessToken(let url, let token):
      return APIClient(auth: AccessTokenAuthProvider(appURL: url, token: token))
    case .oauth(let grant):
      let store = self.store
      let provider = OAuthAuthProvider(
        grant: grant, client: OAuthClient(),
        persist: { renewed in if let renewed { store.save(.oauth(renewed)) } },
        forgetClient: { ClientRegistrationStore().forget(issuer: $0) },
        touchClient: { ClientRegistrationStore().touch(issuer: $0) })
      return APIClient(auth: provider)
    }
  }

  private func use(_ credentials: Credentials, client: APIClient? = nil) {
    self.credentials = credentials
    api = client ?? makeClient(credentials)
    startPolling()
  }

  // MARK: Calendar

  private func startPolling() {
    pollTask?.cancel()
    pollTask = Task { [weak self] in
      while !Task.isCancelled {
        await self?.refresh()
        try? await Task.sleep(for: .seconds(Self.pollInterval))
      }
    }
  }

  func refresh() async {
    guard let api else { return }
    do {
      if me == nil { me = try await api.me() }
      let upcoming = try await api.upcoming(hours: 24)
      events = upcoming.events.filter { ($0.end ?? $0.start.addingTimeInterval(3600)) > Date() }.sorted { $0.start < $1.start }
      calendarConnected = upcoming.connected
      connectURL = upcoming.connectURL ?? me?.connectURL
      calendarError = nil
      await reminders.reconcile(events: upcoming.connected ? events : [])
    } catch APIError.signedOut {
      handleSignedOut()
    } catch {
      calendarError = error.localizedDescription
    }
  }

  func connectCalendar() {
    let url = connectURL ?? appURL
    if let url { NSWorkspace.shared.open(url) }
  }

  private func handleSignedOut() {
    signInError = "Your sign-in expired or was revoked. Sign in again."
    signOut()
  }

  // MARK: Meetings

  func loadMeetings() async {
    guard let api else { return }
    loadingMeetings = true
    defer { loadingMeetings = false }
    do {
      meetings = try await api.meetings()
      meetingsError = nil
    } catch APIError.signedOut {
      handleSignedOut()
    } catch {
      meetingsError = error.localizedDescription
    }
  }

  func open(_ meeting: MeetingSummary) {
    guard let appURL else { return }
    NSWorkspace.shared.open(meeting.pageURL(appURL: appURL))
  }

  func openMeeting(id: String) {
    guard let appURL else { return }
    NSWorkspace.shared.open(appURL.appendingPathComponent("meetings").appendingPathComponent(id))
  }

  func openWebApp() {
    if let appURL { NSWorkspace.shared.open(appURL) }
  }

  // MARK: Recording

  func record(title: String, startsAt: Date = Date(), calendarEventID: String? = nil) {
    guard let api, !recorder.isActive else { return }
    Task { await recorder.start(api: api, title: title, startsAt: startsAt, calendarEventID: calendarEventID) }
  }

  func record(_ event: CalendarEvent) {
    record(title: event.title, startsAt: event.start, calendarEventID: event.id)
  }

  func recordNow() {
    record(title: "Meeting at \(Date().formatted(date: .omitted, time: .shortened))")
  }

  func stopRecording() {
    Task { await recorder.stop() }
  }
}
