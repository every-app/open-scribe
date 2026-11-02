// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "Talk",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "Talk", targets: ["Talk"]),
    .executable(name: "talk-helper", targets: ["talk-helper"]),
  ],
  targets: [
    // Everything that runs without hardware or a window: auth, API, batching, resampling,
    // reminder planning. Tested by `swift test`.
    .target(
      name: "TalkCore",
      path: "Sources/TalkCore",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // The smoke and sign-in commands, shared by the app (`Talk --cli`) and talk-smoke.
    .target(
      name: "TalkCLI",
      dependencies: ["TalkCore"],
      path: "Sources/TalkCLI",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // Capture (mic, Core Audio tap), the Realtime sockets and the chunk fallback, the recording
    // pipeline, call detection, and the helper protocol. No UI, no Keychain. Used by the app and
    // talk-helper; the hardware-free parts are tested with fakes.
    .target(
      name: "TalkRecording",
      dependencies: ["TalkCore"],
      path: "Sources/TalkRecording",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // The headless helper the Electron app spawns: protocol v1 over stdin/stdout.
    .executableTarget(
      name: "talk-helper",
      dependencies: ["TalkRecording"],
      path: "Sources/talk-helper",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // The menu-bar app: SwiftUI, notifications, sign-in; recording comes from TalkRecording.
    .executableTarget(
      name: "Talk",
      dependencies: ["TalkCore", "TalkCLI", "TalkRecording"],
      path: "Sources/Talk",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // Drives the API client through a meeting against a running web/ (no audio), and signs in
    // without a browser click (see TalkCLI).
    .executableTarget(
      name: "talk-smoke",
      dependencies: ["TalkCLI"],
      path: "Sources/talk-smoke",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "TalkCoreTests",
      dependencies: ["TalkCore"],
      path: "Tests/TalkCoreTests",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "TalkRecordingTests",
      dependencies: ["TalkCore", "TalkRecording"],
      path: "Tests/TalkRecordingTests",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
