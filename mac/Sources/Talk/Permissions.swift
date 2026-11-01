@preconcurrency import AVFoundation
import AppKit
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
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: .granted
    case .denied, .restricted: .denied
    case .notDetermined: .notAsked
    @unknown default: .unknown
    }
  }

  /// Asks if never asked; true when the mic may be used.
  static func ensureMicrophone() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return true
    case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
    default: return false
    }
  }

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
  static func primeSystemAudio() {
    let capture = SystemAudioCapture { _ in }
    guard (try? capture.start()) != nil else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { capture.stop() }
  }

  static func openSettings(_ anchor: String) {
    if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(anchor)") {
      NSWorkspace.shared.open(url)
    }
  }
}
