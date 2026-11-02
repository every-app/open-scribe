import AppKit
import TalkRecording
import UserNotifications

/// The three permissions Talk uses, asked from the Settings window or right before a recording
/// starts, never from inside capture code (Scrawl's lesson).
enum Permissions {
  enum Status: Equatable {
    case granted, denied, notAsked, unknown

    var label: String {
      switch self {
      case .granted: "Allowed"
      case .denied: "Not allowed"
      case .notAsked: "Not asked yet"
      case .unknown: "Allowed when first used"
      }
    }
  }

  static var microphone: Status {
    switch CapturePermission.microphone {
    case .granted: .granted
    case .denied: .denied
    case .undetermined: .notAsked
    case .unknown: .unknown
    }
  }

  /// Asks if never asked; true when the mic may be used.
  static func ensureMicrophone() async -> Bool { await CapturePermission.ensureMicrophone() }

  static func notifications() async -> Status {
    guard Bundle.main.bundleIdentifier != nil else { return .unknown }
    switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
    case .authorized, .provisional, .ephemeral: return .granted
    case .denied: return .denied
    case .notDetermined: return .notAsked
    @unknown default: return .unknown
    }
  }

  @discardableResult
  static func requestNotifications() async -> Bool {
    guard Bundle.main.bundleIdentifier != nil else { return false }
    return (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
  }

  /// There's no public API to ask for or read "System Audio Recording Only": macOS asks the first
  /// time a process tap starts. A short tap here brings the prompt up at a calm moment.
  static func primeSystemAudio() { CapturePermission.primeSystemAudio() }

  static func openSettings(_ anchor: String) {
    if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(anchor)") {
      NSWorkspace.shared.open(url)
    }
  }
}
