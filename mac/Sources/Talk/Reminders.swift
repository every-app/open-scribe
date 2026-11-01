import Foundation
import TalkCore
import UserNotifications

/// Meeting prompts: a notification a minute before each meeting, and a nudge once it has started
/// if Talk isn't taking notes. Actions: Join & Take Notes (when there's a call link) and Take Notes.
final class Reminders: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
  static let callCategory = "TALK_MEETING_CALL"
  static let category = "TALK_MEETING"
  static let joinAction = "TALK_JOIN_RECORD"
  static let recordAction = "TALK_RECORD"

  struct RecordRequest: Sendable {
    var eventID: String
    var title: String
    var start: Date
    var conferenceURL: URL?
    var join: Bool
  }

  /// Set by the app: what Take Notes and Join & Take Notes do.
  var onRecord: (@MainActor (RecordRequest) -> Void)?
  /// Started nudges already shown this run.
  @MainActor private var nudged: Set<String> = []

  private var center: UNUserNotificationCenter? {
    // `swift run` has no bundle, and the notification center traps without one.
    Bundle.main.bundleIdentifier == nil ? nil : UNUserNotificationCenter.current()
  }

  func install() {
    guard let center else { return }
    let join = UNNotificationAction(identifier: Self.joinAction, title: "Join & Take Notes", options: [.foreground])
    let record = UNNotificationAction(identifier: Self.recordAction, title: "Take Notes", options: [.foreground])
    center.setNotificationCategories([
      UNNotificationCategory(identifier: Self.callCategory, actions: [join, record], intentIdentifiers: [], options: []),
      UNNotificationCategory(identifier: Self.category, actions: [record], intentIdentifiers: [], options: []),
    ])
    center.delegate = self
  }

  /// Makes the pending prompts match `events`, leaving out the one being recorded.
  func reconcile(events: [CalendarEvent], recordingEventID: String?) async {
    guard let center else { return }
    let delivered = Set(await center.deliveredNotifications().map(\.request.identifier))
    let plan = ReminderPlanner.plan(events: events, now: Date(), delivered: delivered, recordingEventID: recordingEventID)
    let wanted = Set(plan.map(\.identifier))
    let pending = await center.pendingNotificationRequests().map(\.identifier)
      .filter { $0.hasPrefix(ReminderPlanner.identifierPrefix) }
    let stale = pending.filter { !wanted.contains($0) }
    if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: stale) }
    let have = Set(pending)
    for reminder in plan where !have.contains(reminder.identifier) {
      try? await center.add(request(for: reminder))
    }
  }

  /// Shows "<title> started. Take notes?" for meetings under way while Talk isn't recording.
  @MainActor func nudgeStarted(events: [CalendarEvent], recording: Bool) {
    guard let center else { return }
    for event in StartedNudge.due(events: events, now: Date(), recording: recording, nudged: nudged) {
      let id = StartedNudge.identifier(for: event)
      nudged.insert(id)
      // It replaces the one-minute prompt.
      center.removeDeliveredNotifications(withIdentifiers: [ReminderPlanner.identifier(for: event)])
      let content = Self.content(for: event, body: "\(event.title) started. Take notes?")
      center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
  }

  /// Talk is taking notes for `eventID`: its prompts are moot.
  func clear(eventID: String) {
    guard let center else { return }
    Task {
      let match: (String) -> Bool = {
        $0.hasPrefix(ReminderPlanner.identifierPrefix + eventID + ".") || $0.hasPrefix(StartedNudge.identifierPrefix + eventID + ".")
      }
      let pending = await center.pendingNotificationRequests().map(\.identifier).filter(match)
      let delivered = await center.deliveredNotifications().map(\.request.identifier).filter(match)
      center.removePendingNotificationRequests(withIdentifiers: pending)
      center.removeDeliveredNotifications(withIdentifiers: delivered)
    }
  }

  /// An immediate notice with no actions (e.g. "already taking notes").
  func notify(title: String, body: String) {
    guard let center else { return }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    center.add(UNNotificationRequest(identifier: "notice.\(UUID().uuidString)", content: content, trigger: nil))
  }

  func removeAll() {
    guard let center else { return }
    Task {
      let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(ReminderPlanner.identifierPrefix) }
      center.removePendingNotificationRequests(withIdentifiers: ids)
    }
  }

  private func request(for reminder: ReminderPlanner.Reminder) -> UNNotificationRequest {
    let event = reminder.event
    // Written when scheduled, read a minute before: say the time, not "in N minutes".
    let content = Self.content(
      for: event, body: "Starts at \(event.start.formatted(date: .omitted, time: .shortened)). Join and take notes?")
    // A wall-clock trigger, so a Mac that slept still fires on time.
    let trigger: UNNotificationTrigger
    if reminder.fireDate.timeIntervalSinceNow > 5 {
      let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: reminder.fireDate)
      trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
    } else {
      trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    }
    return UNNotificationRequest(identifier: reminder.identifier, content: content, trigger: trigger)
  }

  private static func content(for event: CalendarEvent, body: String) -> UNMutableNotificationContent {
    let content = UNMutableNotificationContent()
    content.title = event.title
    content.body = body
    content.sound = .default
    content.categoryIdentifier = event.conferenceURL == nil ? category : callCategory
    var info: [String: Any] = ["eventID": event.id, "title": event.title, "start": event.start.timeIntervalSince1970]
    if let url = event.conferenceURL { info["conferenceURL"] = url.absoluteString }
    content.userInfo = info
    return content
  }

  // MARK: UNUserNotificationCenterDelegate

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound]
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    let info = response.notification.request.content.userInfo
    guard let id = info["eventID"] as? String else { return }
    let conferenceURL = (info["conferenceURL"] as? String).flatMap(URL.init(string:))
    let join: Bool
    switch response.actionIdentifier {
    case Self.joinAction: join = true
    case Self.recordAction: join = false
    // Clicking the notification itself does the first action.
    case UNNotificationDefaultActionIdentifier: join = conferenceURL != nil
    default: return
    }
    let request = RecordRequest(
      eventID: id, title: info["title"] as? String ?? "Meeting",
      start: Date(timeIntervalSince1970: info["start"] as? TimeInterval ?? Date().timeIntervalSince1970),
      conferenceURL: conferenceURL, join: join)
    await MainActor.run { onRecord?(request) }
  }
}
