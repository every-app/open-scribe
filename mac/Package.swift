// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "OpenZen",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "OpenZen", targets: ["OpenZen"]),
  ],
  targets: [
    // Everything that runs without hardware or a window: auth, API, batching, resampling,
    // reminder planning. Tested by `swift test`.
    .target(
      name: "OpenZenCore",
      path: "Sources/OpenZenCore",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // The menu-bar app: SwiftUI, capture, notifications, the Realtime sockets.
    .executableTarget(
      name: "OpenZen",
      dependencies: ["OpenZenCore"],
      path: "Sources/OpenZen",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // Drives the API client through a meeting against a running web/ (no audio).
    .executableTarget(
      name: "openzen-smoke",
      dependencies: ["OpenZenCore"],
      path: "Sources/openzen-smoke",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "OpenZenCoreTests",
      dependencies: ["OpenZenCore"],
      path: "Tests/OpenZenCoreTests",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
