// The live sky (src/hillside), in demo mode, on the iPhone and the iPad:
// the front page under it for someone signed out, by day and at night
// (the demo started with those preferences stored: -VirgaDemoSky and
// -VirgaDemoLiveSky), and
// five taps on the front page's mark putting it away again; Settings ›
// Appearance's switch turning it on, and the dashboard's page under it by
// day and at night; and five taps on the mark in the app bar or the
// sidebar turning it on, with the web's toast, which Settings then shows.
// Each screen is kept as a screenshot (an XCTAttachment kept always).
//
// The scene itself is decorative and hidden from VoiceOver, so the tests
// find what says it is on (the switch, the toasts) and leave the scene to
// the screenshots, taken a few seconds after it is asked for: the GPU is
// made off the main thread and the canvas fades in over 0.9 seconds.

import UIKit
import XCTest

final class LiveSkyUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private static let out = "The live sky is out. Settings › Appearance puts it away again."
  private static let putAway = "The live sky is put away."

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  private func launch(_ extra: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES"] + extra
    app.launch()
    return app
  }

  private func isDesk(_ app: XCUIApplication) -> Bool {
    isPad && app.windows.firstMatch.frame.width >= 900
  }

  private func snapshot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  private func waitForTitle(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let heading = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'page-title' AND label == %@", title)).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "no page titled \(title)", file: file, line: line)
  }

  private func waitForHome(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page", file: file, line: line)
  }

  private func part(_ app: XCUIApplication, _ key: String) -> XCUIElement {
    element(app, isDesk(app) ? "nav-\(key)" : "tab-\(key)")
  }

  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement) {
    var tries = 0
    while !target.isHittable && tries < 6 {
      app.swipeUp()
      tries += 1
    }
  }

  /// A few seconds for the scene to be made, drawn and faded in. Not an
  /// assertion: only what the next screenshot shows depends on it.
  private func letTheSkyDraw(_ seconds: TimeInterval = 4) {
    let drawn = expectation(description: "the live sky has had time to draw")
    drawn.isInverted = true
    wait(for: [drawn], timeout: seconds)
  }

  /// Five taps on the mark, each well within a second and a half of the last.
  private func tapTheMarkFiveTimes(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
    let mark = element(app, "brand")
    XCTAssertTrue(mark.waitForExistence(timeout: 10), "no mark to tap", file: file, line: line)
    // One event of five taps. Separate taps each wait for the app to settle,
    // which with the live sky drawing took 2 seconds on the iPhone (taps at
    // :31, :33, :34, :35, :35), past SkyTaps' 1.5, so the count began again.
    mark.tap(withNumberOfTaps: 5, numberOfTouches: 1)
  }

  /// The settings page's Appearance, from the account menu.
  private func openAppearance(_ app: XCUIApplication) {
    element(app, "account-menu").tap()
    let settings = button(app, "Accounts and settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    settings.tap()
    let desk = isDesk(app)
    waitForTitle(app, desk ? "Account" : "Settings")
    let appearance = element(app, desk ? "nav-settings-appearance" : "settings-appearance")
    XCTAssertTrue(appearance.waitForExistence(timeout: 5))
    appearance.tap()
    waitForTitle(app, "Appearance")
  }

  /// Appearance's "Show the live sky", scrolled to.
  private func liveSkySwitch(_ app: XCUIApplication) -> XCUIElement {
    let toggle = element(app, "live-sky")
    scrollTo(app, toggle)
    XCTAssertTrue(toggle.exists, "no Show the live sky")
    return toggle
  }

  private func isOn(_ toggle: XCUIElement) -> Bool {
    (toggle.value as? String) == "1"
  }

  func testTheFrontPageUnderTheLiveSky() {
    for sky in ["day", "night"] {
      let app = launch(["-VirgaDemoSignedOut", "YES", "-VirgaDemoSky", sky, "-VirgaDemoLiveSky", "YES"])
      XCTAssertTrue(element(app, "landing-title").waitForExistence(timeout: 15), "no front page")
      letTheSkyDraw()
      snapshot("front-page-live-sky-\(sky)")
      if sky == "night" {
        // five taps on the front page's mark put it away again
        tapTheMarkFiveTimes(app)
        XCTAssertTrue(text(app, Self.putAway).waitForExistence(timeout: 5), "no “\(Self.putAway)”")
        snapshot("front-page-live-sky-put-away")
      }
      app.terminate()
    }
  }

  func testTheLiveSkyFromSettings() {
    let app = launch()
    waitForHome(app)
    openAppearance(app)
    element(app, "sky-day").tap()
    let toggle = liveSkySwitch(app)
    XCTAssertFalse(isOn(toggle), "the live sky starts on")
    toggle.tap()
    XCTAssertTrue(isOn(toggle), "Show the live sky didn't turn on")
    app.swipeDown()
    app.swipeDown()
    letTheSkyDraw()
    snapshot("settings-live-sky")

    part(app, "dashboard").tap()
    waitForHome(app)
    letTheSkyDraw()
    snapshot("live-sky-dashboard-day")

    openAppearance(app)
    element(app, "sky-night").tap()
    part(app, "dashboard").tap()
    waitForHome(app)
    letTheSkyDraw()
    snapshot("live-sky-dashboard-night")
  }

  func testFiveTapsOnTheMarkTurnItOn() {
    let app = launch()
    waitForHome(app)
    tapTheMarkFiveTimes(app)
    XCTAssertTrue(text(app, Self.out).waitForExistence(timeout: 5), "no “\(Self.out)”")
    letTheSkyDraw()
    snapshot("live-sky-five-taps")
    openAppearance(app)
    XCTAssertTrue(isOn(liveSkySwitch(app)), "Settings doesn't show the live sky on")
  }
}
