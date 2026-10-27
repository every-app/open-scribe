import Foundation

/// Which meeting reminders should be pending, given the upcoming events. The app reconciles the
/// notification center with this list on every poll.
public enum ReminderPlanner {
  public static let lead: TimeInterval = 2 * 60
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

  /// Reminders for meetings that haven't started. One whose two-minute mark has passed fires
  /// now, unless it was already delivered (`delivered` holds identifiers).
  public static func plan(events: [CalendarEvent], now: Date, delivered: Set<String> = []) -> [Reminder] {
    events
      .filter { $0.isMeeting && $0.start > now }
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
