// End-to-end checks of the app in its demo mode (a made-up world, no
// network), like the web app's harness, on an iPhone: the shell's tab bar
// reaches every part and each page has its header; Settings changes the sky
// and the accent; the account menu opens. Each screen worth looking at is
// kept as a screenshot (an XCTAttachment kept always, a name per screen),
// which CI exports from the result bundle as the `screenshots` artifact.

import XCTest

final class VirgaUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private func launch(_ extra: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES"] + extra
    app.launch()
    return app
  }

  /// A picture of the whole screen, kept with the results.
  private func snapshot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  /// A button by the words it says (or is read as).
  private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  /// Anything by its accessibility identifier, whatever kind it is read as.
  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func waitForTitle(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let heading = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'page-title' AND label == %@", title)).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "no page titled \(title)", file: file, line: line)
  }

  func testLaunches() {
    let app = launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
  }

  func testOpensOnTheFirstDashboard() {
    let app = launch()
    waitForTitle(app, "Overview")
    XCTAssertTrue(element(app, "unported").exists)
    snapshot("dashboard")
  }

  func testTheTabBarReachesEveryPart() {
    let app = launch()
    waitForTitle(app, "Overview")
    let parts: [(String, String)] = [("reports", "Reports"), ("posting", "Posting"), ("tools", "Tools"), ("dashboard", "Overview")]
    for (key, title) in parts {
      let tab = element(app, "tab-\(key)")
      XCTAssertTrue(tab.waitForExistence(timeout: 5), "no \(key) tab")
      tab.tap()
      waitForTitle(app, title)
      XCTAssertTrue(tab.isSelected, "the \(key) tab isn't marked as the one you are in")
    }
  }

  func testNewPostGoesToPosting() {
    let app = launch()
    waitForTitle(app, "Overview")
    element(app, "tab-new-post").tap()
    waitForTitle(app, "Posting")
  }

  func testTheAccountMenuOpens() {
    let app = launch()
    waitForTitle(app, "Overview")
    let menu = element(app, "account-menu")
    XCTAssertTrue(menu.waitForExistence(timeout: 5))
    menu.tap()
    XCTAssertTrue(button(app, "Add an account").waitForExistence(timeout: 5))
    XCTAssertTrue(button(app, "Accounts and settings").exists)
    snapshot("account-menu")
  }

  /// Settings by way of the account menu, then Appearance.
  private func openAppearance(_ app: XCUIApplication) {
    waitForTitle(app, "Overview")
    element(app, "account-menu").tap()
    let settings = button(app, "Accounts and settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    settings.tap()
    waitForTitle(app, "Settings")
    let appearance = element(app, "settings-appearance")
    XCTAssertTrue(appearance.waitForExistence(timeout: 5))
    appearance.tap()
    waitForTitle(app, "Appearance")
  }

  func testSettingsChangesTheSkyAndTheAccent() {
    let app = launch()
    openAppearance(app)

    let day = element(app, "sky-day")
    XCTAssertTrue(day.waitForExistence(timeout: 5))
    day.tap()
    XCTAssertTrue(day.isSelected)
    snapshot("settings-day")

    let night = element(app, "sky-night")
    night.tap()
    XCTAssertTrue(night.isSelected)
    XCTAssertFalse(day.isSelected)
    snapshot("settings-night")

    let violet = element(app, "accent-violet")
    if !violet.isHittable { app.swipeUp() }
    violet.tap()
    XCTAssertTrue(violet.isSelected)
    XCTAssertFalse(element(app, "accent-blue").isSelected)
  }

  func testSettingsInHighContrast() {
    let app = launch()
    openAppearance(app)
    element(app, "sky-day").tap()
    let high = button(app, "High")
    if !high.isHittable { app.swipeUp() }
    high.tap()
    XCTAssertTrue(high.isSelected)
    app.swipeDown()
    snapshot("settings-day-high-contrast")
    element(app, "sky-night").tap()
    snapshot("settings-night-high-contrast")
  }

  func testTheFrontPageForSomeoneSignedOut() {
    let app = launch(["-VirgaDemoSignedOut", "YES"])
    XCTAssertTrue(element(app, "landing-title").waitForExistence(timeout: 15))
    XCTAssertTrue(element(app, "handle-field").exists)
    XCTAssertTrue(button(app, "Continue as Mira Okafor").exists)
    snapshot("front-page")
  }

  func testTheAgreementScreenComesFirstAndLetsYouIn() {
    let app = launch(["-VirgaDemoTerms", "YES"])
    let title = element(app, "terms-title")
    XCTAssertTrue(title.waitForExistence(timeout: 15))
    snapshot("agreement")
    element(app, "terms-agree").tap()
    // Pressed before the box is ticked, it says what is missing.
    let nudge = app.staticTexts.matching(NSPredicate(format: "label == %@", "Tick the box to say you agree, then carry on.")).firstMatch
    XCTAssertTrue(nudge.waitForExistence(timeout: 5))
    element(app, "terms-check").tap()
    element(app, "terms-agree").tap()
    waitForTitle(app, "Overview")
  }
}
