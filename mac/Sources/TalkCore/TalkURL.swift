import Foundation

/// `talk://record[?event=<calendarEventId>&title=<t>&start=<ISO 8601>&join=1]`, opened by the web
/// app's Record buttons. Any web page can open one, so nothing here is trusted: see `resolve`.
public struct TalkURL: Equatable, Sendable {
  public static let scheme = "talk"
  static let maxTitle = 200

  public var eventID: String?
  public var title: String?
  public var start: Date?
  public var join: Bool

  public init(eventID: String? = nil, title: String? = nil, start: Date? = nil, join: Bool = false) {
    self.eventID = eventID
    self.title = title
    self.start = start
    self.join = join
  }

  /// nil for anything but a `talk://record` URL.
  public static func parse(_ url: URL) -> TalkURL? {
    guard url.scheme?.lowercased() == scheme,
      let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return nil }
    // `talk://record` puts it in the host; `talk:record` in the path.
    let command = (parts.host ?? parts.path).trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
    guard command == "record" else { return nil }
    func value(_ name: String) -> String? {
      let v = parts.queryItems?.first { $0.name == name }?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
      return v?.isEmpty == false ? v : nil
    }
    let title = value("title").map { text in
      String(text.filter { c in !c.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) } }.prefix(maxTitle))
    }
    let join = value("join").map { ["1", "true", "yes"].contains($0.lowercased()) } ?? false
    return TalkURL(eventID: value("event"), title: title, start: value("start").flatMap(FlexibleDate.parse), join: join)
  }

  public enum Action: Equatable, Sendable {
    /// An event the app already knows: start at once, with the app's own details.
    case start(CalendarEvent, join: Bool)
    /// Anything else: ask the person first. Never opens a link from the URL.
    case confirm(title: String, start: Date?, eventID: String?)
  }

  /// `fallbackTitle` names a meeting the URL didn't.
  public func resolve(upcoming: [CalendarEvent], fallbackTitle: String) -> Action {
    if let eventID, let event = upcoming.first(where: { $0.id == eventID }) {
      return .start(event, join: join)
    }
    return .confirm(title: title ?? fallbackTitle, start: start, eventID: eventID)
  }
}
