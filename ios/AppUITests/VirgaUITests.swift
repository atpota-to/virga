// End-to-end checks of the app in its demo mode (a made-up world, no
// network), like the web app's harness.

import XCTest

final class VirgaUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  func testLaunches() {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES"]
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
  }
}
