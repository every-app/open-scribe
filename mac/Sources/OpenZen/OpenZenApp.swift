import AppKit
import SwiftUI

@main
struct OpenZenApp: App {
  @StateObject private var model = AppModel()

  init() {
    // OPENZEN_DIAG=1: print the app's windows (the status item's among them) after launch.
    if ProcessInfo.processInfo.environment["OPENZEN_DIAG"] == "1" {
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
      MenuBarIcon(recorder: model.recorder)
    }
    .menuBarExtraStyle(.menu)

    Window("Meetings", id: "meetings") {
      MeetingsView(model: model)
    }
    .defaultSize(width: 420, height: 480)
    .windowResizability(.contentMinSize)

    Window("OpenZen Settings", id: "settings") {
      SettingsView(model: model)
    }
    .windowResizability(.contentSize)
  }
}

/// A waveform normally; a red record dot while recording. The red one isn't a template image,
/// so the menu bar keeps its color.
struct MenuBarIcon: View {
  @ObservedObject var recorder: Recorder

  var body: some View {
    if case .recording = recorder.state {
      Image(nsImage: Self.recordingImage)
    } else {
      Image(systemName: "waveform")
    }
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
