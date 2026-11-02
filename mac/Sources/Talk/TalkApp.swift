import AppKit
import SwiftUI

struct TalkApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @StateObject private var model = AppModel()

  init() {
    // TALK_DIAG=1: print the app's windows (the status item's among them) after launch.
    if ProcessInfo.processInfo.environment["TALK_DIAG"] == "1" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        for window in NSApp.windows {
          FileHandle.standardError.write(Data("window \(type(of: window)) \(window.frame) visible=\(window.isVisible)\n".utf8))
        }
      }
    }
  }

  var body: some Scene {
    MenuBarExtra {
      MenuContent(model: model, recorder: model.recorder)
    } label: {
      MenuBarIcon(model: model, recorder: model.recorder)
    }
    .menuBarExtraStyle(.menu)

    Window("Talk Settings", id: "settings") {
      SettingsView(model: model)
    }
    .windowResizability(.contentSize)
  }
}

/// A waveform normally; a red record dot while recording. The red one isn't a template image,
/// so the menu bar keeps its color.
/// It's always on screen, so it hands the model SwiftUI's `openWindow` (for talk:// URLs).
struct MenuBarIcon: View {
  let model: AppModel
  @ObservedObject var recorder: Recorder
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Group {
      if case .recording = recorder.state {
        Image(nsImage: Self.recordingImage)
      } else {
        Image(systemName: "waveform")
      }
    }
    .onAppear { model.openSettingsWindow = { [openWindow] in openWindow(id: "settings") } }
  }

  static let recordingImage: NSImage = {
    let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
      .applying(NSImage.SymbolConfiguration(paletteColors: [.systemRed]))
    let image = NSImage(systemSymbolName: "record.circle.fill", accessibilityDescription: "Recording")!
      .withSymbolConfiguration(config)!
    image.isTemplate = false
    return image
  }()
}

/// Brings a window of this menu-bar-only app to the front.
@MainActor
func activateApp() {
  NSApp.activate()
}

/// Takes talk:// URLs straight from the Apple Event, so SwiftUI doesn't route them to a window.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationWillFinishLaunching(_ notification: Notification) {
    NSAppleEventManager.shared().setEventHandler(
      self, andSelector: #selector(handleGetURL(_:reply:)),
      forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
  }

  @objc func handleGetURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
    guard let text = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue, let url = URL(string: text) else { return }
    AppModel.open(url)
  }
}
