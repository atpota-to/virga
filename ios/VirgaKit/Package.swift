// swift-tools-version: 6.0
//
// VirgaKit: everything in the iOS app except the app target itself.
//
// The logic targets (all but VirgaUI) are plain Swift on Foundation and
// Observation, so they build and test on Linux as well as on Apple
// platforms. That is what lets `swift test` run them anywhere and lets the
// parity fixtures (ios/parity/) hold them to the web app's own output.
// VirgaUI is SwiftUI and only exists where SwiftUI does.
//
// The dependency graph follows the web app's (ios/PORTING.md, Targets):
//
//   VirgaCore ← VirgaNetwork ← VirgaSession ← VirgaArchive ← VirgaPosting
//   VirgaCore ← VirgaRepo ─────────────────────↑
//   VirgaInsights, VirgaDefense ← (Archive, Posting, Session)
//   VirgaDemo ← everything above (a fake network for previews and UI tests)
//   VirgaUI ← everything (Apple platforms only)

import PackageDescription

let strict: [SwiftSetting] = [
  .swiftLanguageMode(.v6),
]

var products: [Product] = [
  .library(name: "VirgaCore", targets: ["VirgaCore"]),
  .library(name: "VirgaNetwork", targets: ["VirgaNetwork"]),
  .library(name: "VirgaRepo", targets: ["VirgaRepo"]),
  .library(name: "VirgaSession", targets: ["VirgaSession"]),
  .library(name: "VirgaArchive", targets: ["VirgaArchive"]),
  .library(name: "VirgaPosting", targets: ["VirgaPosting"]),
  .library(name: "VirgaInsights", targets: ["VirgaInsights"]),
  .library(name: "VirgaDefense", targets: ["VirgaDefense"]),
  .library(name: "VirgaDemo", targets: ["VirgaDemo"]),
]

let logicTargets = [
  "VirgaCore", "VirgaNetwork", "VirgaRepo", "VirgaSession", "VirgaArchive",
  "VirgaPosting", "VirgaInsights", "VirgaDefense", "VirgaDemo",
]

var targets: [Target] = [
  .target(name: "VirgaCore", swiftSettings: strict),
  .target(name: "VirgaNetwork", dependencies: ["VirgaCore"], swiftSettings: strict),
  .target(name: "VirgaRepo", dependencies: ["VirgaCore"], swiftSettings: strict),
  .target(name: "VirgaSession", dependencies: ["VirgaCore", "VirgaNetwork"], swiftSettings: strict),
  .target(
    name: "VirgaArchive",
    dependencies: ["VirgaCore", "VirgaNetwork", "VirgaRepo", "VirgaSession"],
    swiftSettings: strict
  ),
  .target(
    name: "VirgaPosting",
    dependencies: ["VirgaCore", "VirgaNetwork", "VirgaRepo", "VirgaSession", "VirgaArchive"],
    swiftSettings: strict
  ),
  .target(
    name: "VirgaInsights",
    dependencies: ["VirgaCore", "VirgaNetwork", "VirgaSession", "VirgaArchive", "VirgaPosting"],
    swiftSettings: strict
  ),
  .target(
    name: "VirgaDefense",
    dependencies: ["VirgaCore", "VirgaNetwork", "VirgaSession", "VirgaArchive", "VirgaPosting"],
    swiftSettings: strict
  ),
  .target(
    name: "VirgaDemo",
    dependencies: [
      "VirgaCore", "VirgaNetwork", "VirgaRepo", "VirgaSession", "VirgaArchive",
      "VirgaPosting", "VirgaInsights", "VirgaDefense",
    ],
    exclude: ["README.md"],
    swiftSettings: strict
  ),

  // Shared by the test targets: loading parity fixtures and comparing JSON.
  // Deliberately does not import Testing, so it links anywhere.
  .target(
    name: "VirgaTestSupport",
    dependencies: ["VirgaCore", "VirgaNetwork"],
    path: "Tests/VirgaTestSupport",
    swiftSettings: strict
  ),
]

for name in logicTargets {
  targets.append(
    .testTarget(
      name: "\(name)Tests",
      dependencies: [.target(name: name), "VirgaTestSupport"],
      swiftSettings: strict
    )
  )
}

#if canImport(Darwin)
// SwiftUI. Swift 5 language mode: the views are main-actor code built only
// by Xcode (CI's macOS job), and the strict checking lives in the logic
// targets they bind to.
products.append(.library(name: "VirgaUI", targets: ["VirgaUI"]))
targets.append(
  .target(
    name: "VirgaUI",
    dependencies: logicTargets.map { .target(name: $0) },
    swiftSettings: [.swiftLanguageMode(.v5)]
  )
)
#endif

let package = Package(
  name: "VirgaKit",
  platforms: [.iOS("17.4"), .macOS(.v14)],
  products: products,
  targets: targets
)
