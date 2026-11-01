// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "Talk",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "Talk", targets: ["Talk"]),
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
    // The menu-bar app: SwiftUI, capture, notifications, the Realtime sockets.
    .executableTarget(
      name: "Talk",
      dependencies: ["TalkCore", "TalkCLI"],
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
  ]
)
