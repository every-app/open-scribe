import Foundation
import TalkCore
import UserNotifications

/// A local notification two minutes before each meeting, with one action: Record.
final class Reminders: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
  static let category = "TALK_MEETING"
  static let recordAction = "TALK_RECORD"

  struct RecordRequest: Sendable {
    var eventID: String
    var title: String
    var start: Date
  }

  /// Set by the app: what Record does.
  var onRecord: (@MainActor (RecordRequest) -> Void)?

  private var center: UNUserNotificationCenter? {
    // `swift run` has no bundle, and the notification center traps without one.
    Bundle.main.bundleIdentifier == nil ? nil : UNUserNotificationCenter.current()
  }

  func install() {
    guard let center else { return }
    let record = UNNotificationAction(identifier: Self.recordAction, title: "Record", options: [.foreground])
    let category = UNNotificationCategory(identifier: Self.category, actions: [record], intentIdentifiers: [], options: [])
    center.setNotificationCategories([category])
    center.delegate = self
  }

  /// Makes the pending reminders match `events`.
  func reconcile(events: [CalendarEvent]) async {
    guard let center else { return }
    let delivered = Set(await center.deliveredNotifications().map(\.request.identifier))
    let plan = ReminderPlanner.plan(events: events, now: Date(), delivered: delivered)
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

  func removeAll() {
    guard let center else { return }
    Task {
      let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(ReminderPlanner.identifierPrefix) }
      center.removePendingNotificationRequests(withIdentifiers: ids)
    }
  }

  private func request(for reminder: ReminderPlanner.Reminder) -> UNNotificationRequest {
    let event = reminder.event
    let content = UNMutableNotificationContent()
    content.title = event.title
    // Written when scheduled, read two minutes before: say the time, not "in N minutes".
    content.body = "Starts at \(event.start.formatted(date: .omitted, time: .shortened))"
    content.sound = .default
    content.categoryIdentifier = Self.category
    content.userInfo = ["eventID": event.id, "title": event.title, "start": event.start.timeIntervalSince1970]
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

  // MARK: UNUserNotificationCenterDelegate

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound]
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    guard response.actionIdentifier == Self.recordAction else { return }
    let info = response.notification.request.content.userInfo
    guard let id = info["eventID"] as? String else { return }
    let request = RecordRequest(
      eventID: id, title: info["title"] as? String ?? "Meeting",
      start: Date(timeIntervalSince1970: info["start"] as? TimeInterval ?? Date().timeIntervalSince1970))
    await MainActor.run { onRecord?(request) }
  }
}
