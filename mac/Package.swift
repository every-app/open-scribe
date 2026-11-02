// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "Talk",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "talk-helper", targets: ["talk-helper"]),
  ],
  targets: [
    // No hardware: the API client, segment batching, echo dedupe, resampling, turn detection,
    // chunking, WAV. Tested by `./scripts/test.sh`.
    .target(
      name: "TalkCore",
      path: "Sources/TalkCore",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // Capture (mic, Core Audio tap), the Realtime sockets and the chunk fallback, the recording
    // pipeline, call detection, and the helper protocol. No UI, no Keychain. Used by talk-helper;
    // the hardware-free parts are tested with fakes.
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
    // Drives the API client through a meeting against a running web/ with a bearer token (no
    // audio, no Keychain).
    .executableTarget(
      name: "talk-smoke",
      dependencies: ["TalkCore"],
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
