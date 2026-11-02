import Foundation

/// Which meeting prompts should be pending, given the upcoming events. The app reconciles the
/// notification center with this list on every poll.
public enum ReminderPlanner {
  public static let lead: TimeInterval = 60
  public static let identifierPrefix = "meeting."

  public struct Reminder: Equatable, Sendable {
    /// Stable per event and start time: a moved meeting gets a new reminder.
    public var identifier: String
    public var fireDate: Date
    public var event: CalendarEvent
  }

  public static func identifier(for event: CalendarEvent) -> String {
    "\(identifierPrefix)\(event.id).\(Int(event.start.timeIntervalSince1970))"
  }

  /// Prompts for meetings that haven't started, one minute before. One whose mark has passed
  /// fires now, unless it was already delivered (`delivered` holds identifiers). The event Talk
  /// is already taking notes for (`recordingEventID`) gets none.
  public static func plan(
    events: [CalendarEvent], now: Date, delivered: Set<String> = [], recordingEventID: String? = nil
  ) -> [Reminder] {
    events
      .filter { $0.isMeeting && $0.start > now && $0.id != recordingEventID }
      .compactMap { event in
        let id = identifier(for: event)
        let due = event.start.addingTimeInterval(-lead)
        if due > now { return Reminder(identifier: id, fireDate: due, event: event) }
        if delivered.contains(id) { return nil }
        return Reminder(identifier: id, fireDate: now.addingTimeInterval(1), event: event)
      }
      .sorted { $0.fireDate < $1.fireDate }
  }
}

/// The nudge once a meeting has begun and Talk isn't taking notes. Checked by the app at run time
/// (it depends on the recorder), so it can't be a scheduled notification.
public enum StartedNudge {
  /// How long after the start a meeting still gets the nudge.
  public static let window: TimeInterval = 5 * 60
  public static let identifierPrefix = "started."

  public static func identifier(for event: CalendarEvent) -> String {
    "\(identifierPrefix)\(event.id).\(Int(event.start.timeIntervalSince1970))"
  }

  /// Meetings that started in the last five minutes and haven't been nudged (`nudged` holds
  /// identifiers). None while Talk is recording anything.
  public static func due(events: [CalendarEvent], now: Date, recording: Bool, nudged: Set<String>) -> [CalendarEvent] {
    guard !recording else { return [] }
    return events
      .filter { $0.isMeeting && $0.start <= now && now < $0.start.addingTimeInterval(window) && ($0.end ?? .distantFuture) > now }
      .filter { !nudged.contains(identifier(for: $0)) }
      .sorted { $0.start < $1.start }
  }
}
