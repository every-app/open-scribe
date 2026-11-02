import AppKit
import Foundation
import TalkCLI
import TalkCore
import os

/// `log show --predicate 'subsystem == "com.everyapp.talk"'`. Hosts and counts only, never tokens.
let log = Logger(subsystem: "com.everyapp.talk", category: "app")

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
  @Published var signingIn = false
  @Published var signInError: String?

  let recorder = Recorder()
  let reminders = Reminders()
  private let store = CredentialStore()
  private(set) var api: APIClient?
  private var pollTask: Task<Void, Never>?
  private var signInTask: Task<Void, Never>?
  private var wakeObserver: NSObjectProtocol?
  private var nudgeTimer: Timer?
  /// Opens the Settings window; set by the menu bar icon, which has SwiftUI's `openWindow`.
  var openSettingsWindow: (() -> Void)?
  private var handlingURL = false

  init() {
    reminders.install()
    reminders.onRecord = { [weak self] request in
      if request.join, let url = request.conferenceURL { NSWorkspace.shared.open(url) }
      self?.record(title: request.title, startsAt: request.start, calendarEventID: request.eventID)
    }
    // The "started, take notes?" nudge depends on the recorder, so it's checked here, not scheduled.
    nudgeTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.nudgeStartedMeetings() }
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
    // `talk-smoke signin|refresh|signout` changed the stored sign-in: pick it up.
    credentialsObserver = DistributedNotificationCenter.default().addObserver(
      forName: CLI.credentialsChanged, object: nil, queue: .main
    ) { [weak self] _ in
      Task { @MainActor in self?.reloadCredentials() }
    }
    // `talk-smoke app-state`: answer with what the menu shows.
    stateObserver = DistributedNotificationCenter.default().addObserver(
      forName: CLI.stateRequest, object: nil, queue: .main
    ) { note in
      guard let nonce = note.object as? String else { return }
      MainActor.assumeIsolated {
        guard let self = AppModel.current else { return }
        DistributedNotificationCenter.default().postNotificationName(
          CLI.stateReply, object: nonce, userInfo: self.stateSnapshot(), deliverImmediately: true)
      }
    }
    switch store.probe() {
    case .readable(let saved): use(saved)
    case .unreadable:
      keychainUnreadable = true
      signInError = "This build of Talk can't read your saved sign-in. Sign in again."
      log.error("saved sign-in unreadable (another build's Keychain partition)")
    case .missing: break
    }
    AppModel.current = self
    log.notice("launched; signed in: \(self.credentials != nil, privacy: .public)")
    for url in Self.pendingURLs { handle(url) }
    Self.pendingURLs = []
  }

  /// The one model, for the state query.
  static weak var current: AppModel?
  private var credentialsObserver: NSObjectProtocol?
  private var stateObserver: NSObjectProtocol?
  private(set) var lastRefresh: Date?
  /// A saved sign-in exists but this build can't read it (a dev rebuild without a Team ID).
  private(set) var keychainUnreadable = false

  /// What the menu shows, as text: for `app-state` and nothing else. Counts, not meeting titles.
  func stateSnapshot() -> [String: String] {
    var state: [String: String] = [
      "pid": String(ProcessInfo.processInfo.processIdentifier),
      "signedIn": String(isSignedIn),
      "recorder": "\(recorder.state)".components(separatedBy: "(").first ?? "",
      "icon": recorder.state.isRecording ? "record.circle.fill (red)" : "waveform",
    ]
    if let credentials {
      state["host"] = credentials.appURL.host ?? ""
      if case .oauth(let grant) = credentials {
        state["method"] = "every-app"
        state["gateway"] = grant.issuer.host ?? ""
      } else {
        state["method"] = "access-token"
      }
    }
    if let email = me?.email { state["email"] = email }
    if keychainUnreadable && !isSignedIn { state["keychain"] = "unreadable: \(CLI.unreadableSentence)" }
    state["calendar.connected"] = String(calendarConnected)
    state["calendar.upcoming"] = String(events.count)
    if let calendarError { state["calendar.error"] = calendarError }
    if let lastRefresh { state["calendar.lastRefresh"] = lastRefresh.formatted(.iso8601) }
    for (i, line) in menuLines().enumerated() { state["menu.\(i)"] = line }
    return state
  }

  /// The menu's items in order, as MenuContent draws them (meeting titles left out).
  func menuLines() -> [String] {
    var lines: [String] = []
    if isSignedIn {
      switch recorder.state {
      case .idle: lines.append("Take Notes Now")
      case .starting: lines.append("Starting…")
      case .recording: lines += ["● Recording", recorder.liveLine == nil ? "Listening…" : "(live line)", "Stop Recording"]
      case .stopping: lines.append("Saving…")
      }
      if !calendarConnected {
        lines.append("Connect Google Calendar…")
      } else if events.isEmpty {
        lines.append(calendarError.map { "Calendar: \($0)" } ?? "No meetings in the next 24 hours")
      } else {
        lines.append("Upcoming")
        lines.append("(\(min(events.count, 8)) meeting\(events.count == 1 ? "" : "s"))")
      }
      lines.append("Open Talk")
      if let host = appURL?.host { lines.append("Signed in to \(host)") }
    } else {
      lines += ["Not signed in", "Sign In…"]
    }
    lines += ["Settings…", "Quit Talk"]
    return lines
  }

  /// Re-reads the Keychain after another process (the CLI) changed it.
  func reloadCredentials() {
    let saved = store.load()
    if saved != nil { keychainUnreadable = false }
    log.notice("sign-in changed elsewhere; now signed in to \(saved?.appURL.host ?? "nothing", privacy: .public)")
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
      pollTask?.cancel()
      reminders.removeAll()
    }
  }

  var isSignedIn: Bool { credentials != nil }
  var appURL: URL? { credentials?.appURL }

  // MARK: Sign-in

  func signIn(appURLText: String, token: String) {
    guard let url = URL.typed(appURLText), let origin = url.origin else {
      signInError = "Enter the app's address, like https://talk.example.com."
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

  /// The person types only the Talk app's URL; the app names its Gateway (RFC 9728).
  func signInWithEveryApp(appURLText: String) {
    guard let appURL = URL.typed(appURLText)?.origin else {
      signInError = "Enter the Talk app's address, like https://talk.example.com."
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
        signInError = "Talk didn't accept that token."
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
      lastRefresh = Date()
      log.notice("calendar: connected \(upcoming.connected, privacy: .public), \(self.events.count, privacy: .public) upcoming")
      await reminders.reconcile(events: upcoming.connected ? events : [], recordingEventID: recorder.calendarEventID)
      nudgeStartedMeetings()
    } catch APIError.signedOut {
      handleSignedOut()
    } catch {
      calendarError = error.localizedDescription
      lastRefresh = Date()
      log.error("calendar: \(error.localizedDescription, privacy: .public)")
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

  private func nudgeStartedMeetings() {
    guard isSignedIn, calendarConnected else { return }
    reminders.nudgeStarted(events: events, recording: recorder.isActive)
  }

  func showSettings() {
    if let openSettingsWindow { openSettingsWindow() }
    activateApp()
  }

  // MARK: Web app

  func openMeeting(id: String) {
    guard let appURL else { return }
    NSWorkspace.shared.open(appURL.appendingPathComponent("meetings").appendingPathComponent(id))
  }

  func openWebApp() {
    if let appURL { NSWorkspace.shared.open(appURL) }
  }

  // MARK: Recording

  /// A calendar event's attendees go to the server with the meeting.
  func record(title: String, startsAt: Date = Date(), calendarEventID: String? = nil) {
    guard let api, !recorder.isActive else { return }
    let attendees = calendarEventID.flatMap { id in events.first { $0.id == id } }?.attendees ?? []
    Task {
      await recorder.start(api: api, title: title, startsAt: startsAt, calendarEventID: calendarEventID, attendees: attendees)
      // Taking notes for it now: its prompts are moot.
      if let calendarEventID, recorder.isActive { reminders.clear(eventID: calendarEventID) }
    }
  }

  /// `join` also opens the event's call.
  func record(_ event: CalendarEvent, join: Bool = false) {
    if join, let url = event.conferenceURL { NSWorkspace.shared.open(url) }
    record(title: event.title, startsAt: event.start, calendarEventID: event.id)
  }

  func recordNow() {
    record(title: Self.nowTitle())
  }

  func stopRecording() {
    Task { await recorder.stop() }
  }

  static func nowTitle() -> String {
    "Meeting at \(Date().formatted(date: .omitted, time: .shortened))"
  }

  // MARK: talk:// URLs

  /// URLs that arrived before the model existed (the app was launched by one).
  static var pendingURLs: [URL] = []

  static func open(_ url: URL) {
    if let current { current.handle(url) } else { pendingURLs.append(url) }
  }

  /// Any web page can open a talk:// URL, so the mic starts at once only for an event the app
  /// itself knows; anything else asks first.
  func handle(_ url: URL) {
    guard let request = TalkURL.parse(url) else {
      log.notice("ignored URL with scheme \(url.scheme ?? "", privacy: .public)")
      return
    }
    guard isSignedIn else { return showSettings() }
    guard !recorder.isActive else { return alreadyTakingNotes() }
    guard !handlingURL else { return }
    handlingURL = true
    Task {
      defer { handlingURL = false }
      // Launched by the URL: the calendar hasn't loaded yet.
      if lastRefresh == nil { await refresh() }
      guard !recorder.isActive else { return alreadyTakingNotes() }
      switch request.resolve(upcoming: events, fallbackTitle: Self.nowTitle()) {
      case .start(let event, let join):
        record(event, join: join)
      case .confirm(let title, let start, let eventID):
        guard confirmStart(title: title), !recorder.isActive else { return }
        record(title: title, startsAt: start ?? Date(), calendarEventID: eventID)
      }
    }
  }

  private func confirmStart(title: String) -> Bool {
    activateApp()
    let alert = NSAlert()
    alert.messageText = "Start taking notes for “\(title)”?"
    alert.informativeText = "Talk will transcribe your microphone and your Mac's sound."
    alert.addButton(withTitle: "Take Notes")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
  }

  private func alreadyTakingNotes() {
    let title: String
    switch recorder.state {
    case .starting(let t), .recording(_, let t, _), .stopping(let t): title = t
    case .idle: return
    }
    reminders.notify(title: "Talk is already taking notes", body: "For “\(title)”. Stop it from the menu bar to start another.")
  }
}
