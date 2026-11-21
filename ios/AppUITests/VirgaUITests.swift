// End-to-end checks of the app in its demo mode (a made-up world, no
// network), like the web app's harness, on an iPhone and on an iPad: the
// shell reaches every part and each page has its header; Settings changes
// the sky and the accent; the account menu opens; the first build runs;
// the command palette finds a page; Settings › Data; the sign-in finds a
// handle; the front page, the Terms and the agreement. Each screen worth
// looking at is kept as a screenshot (an XCTAttachment kept always, a name
// per screen), which CI exports from each result bundle into the
// `screenshots` artifact, a folder per device.
//
// The shell differs by the window: from 900 points wide (an iPad, held on
// its side here so any iPad is that wide) the parts are links down the
// sidebar, with New post under the account at its top; narrower, they are
// the tab bar's buttons, with the account at the top of a part's front page.

import UIKit
import XCTest

final class VirgaUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  private func launch(_ extra: [String] = []) -> XCUIApplication {
    if isPad { XCUIDevice.shared.orientation = .landscapeLeft }
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES"] + extra
    app.launch()
    return app
  }

  /// Whether the app has its sidebar: an iPad's window from 900 wide.
  private func isDesk(_ app: XCUIApplication) -> Bool {
    isPad && app.windows.firstMatch.frame.width >= 900
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

  /// The first dashboard, which in the demo is the first build's page: the
  /// demo's network turns the archive's reads away until the made-up
  /// world's network is ported, so there is nothing to chart yet.
  private func waitForHome(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page", file: file, line: line)
  }

  /// A part of Virga: the sidebar's link to it, or the tab bar's button.
  private func part(_ app: XCUIApplication, _ key: String) -> XCUIElement {
    element(app, isDesk(app) ? "nav-\(key)" : "tab-\(key)")
  }

  /// Swipes the page up until `target` can be pressed (a few times at most).
  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement) {
    var tries = 0
    while !target.isHittable && tries < 6 {
      app.swipeUp()
      tries += 1
    }
  }

  func testLaunches() {
    let app = launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
  }

  func testOpensOnTheFirstDashboard() {
    let app = launch()
    waitForHome(app)
    XCTAssertTrue(element(app, "first-run-build").exists, "no Build your archive")
    if isDesk(app) {
      XCTAssertTrue(element(app, "sidebar").exists, "no sidebar from 900 wide")
    } else {
      XCTAssertTrue(element(app, "tab-bar").exists, "no tab bar under 900 wide")
      XCTAssertTrue(element(app, "app-bar").exists, "no app bar at the top of the front page")
    }
    snapshot("dashboard")
  }

  func testTheShellReachesEveryPart() {
    let app = launch()
    waitForHome(app)
    let desk = isDesk(app)
    // The tab bar marks the part you are in; the sidebar marks a part's
    // front page when you are on it (on a dashboard or in Posting, the page
    // under the part is the one marked). Reports and the dashboard need the
    // archive, so in the demo they show the first build's page (no title).
    let parts: [(key: String, title: String?, marked: Bool)] = [
      ("reports", nil, true), ("posting", "Posting", !desk), ("tools", "Tools", true), ("dashboard", nil, !desk),
    ]
    for (key, title, marked) in parts {
      let link = part(app, key)
      XCTAssertTrue(link.waitForExistence(timeout: 5), "no way to \(key)")
      link.tap()
      if let title { waitForTitle(app, title) } else { waitForHome(app) }
      if marked {
        XCTAssertTrue(link.isSelected, "\(key) isn't marked as where you are")
      }
      if key == "reports" || key == "tools" { snapshot(key) }
    }
  }

  func testNewPostGoesToPosting() {
    let app = launch()
    waitForHome(app)
    element(app, isDesk(app) ? "sidebar-new-post" : "tab-new-post").tap()
    waitForTitle(app, "Posting")
  }

  func testTheAccountMenuOpens() {
    let app = launch()
    waitForHome(app)
    let menu = element(app, "account-menu")
    XCTAssertTrue(menu.waitForExistence(timeout: 5))
    menu.tap()
    XCTAssertTrue(button(app, "Add an account").waitForExistence(timeout: 5))
    XCTAssertTrue(button(app, "Accounts and settings").exists)
    snapshot("account-menu")
  }

  /// Settings by way of the account menu, then Appearance: on a phone from
  /// the list of sections, beside the sidebar from its link under Settings
  /// (the bare address opens Account there).
  private func openAppearance(_ app: XCUIApplication) {
    waitForHome(app)
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
    scrollTo(app, violet)
    violet.tap()
    XCTAssertTrue(violet.isSelected)
    XCTAssertFalse(element(app, "accent-blue").isSelected)
  }

  func testSettingsInHighContrast() {
    let app = launch()
    openAppearance(app)
    element(app, "sky-day").tap()
    let high = button(app, "High")
    scrollTo(app, high)
    high.tap()
    XCTAssertTrue(high.isSelected)
    app.swipeDown()
    snapshot("settings-day-high-contrast")
    element(app, "sky-night").tap()
    snapshot("settings-night-high-contrast")
  }

  /// The first dashboard under the day sky, whatever the clock says.
  func testTheDashboardByDay() {
    let app = launch()
    openAppearance(app)
    let day = element(app, "sky-day")
    XCTAssertTrue(day.waitForExistence(timeout: 5))
    day.tap()
    XCTAssertTrue(day.isSelected)
    part(app, "dashboard").tap()
    waitForHome(app)
    snapshot("dashboard-day")
  }

  /// The first build, pressed: its steps while it runs, then whatever the
  /// demo's network lets it reach (the stub turns the archive's reads
  /// away, so the steps fail and the page says what went wrong).
  func testTheFirstBuildRuns() {
    let app = launch()
    waitForHome(app)
    snapshot("first-run")
    element(app, "first-run-build").tap()
    let steps = element(app, "sync-steps")
    let failed = element(app, "first-run-error")
    let started = steps.waitForExistence(timeout: 5) || failed.exists
    snapshot("first-run-building")
    XCTAssertTrue(started, "the build didn't start")
    _ = failed.waitForExistence(timeout: 60)
    snapshot("first-run-after")
  }

  /// The command palette, from Search, with a few letters typed; then one
  /// of its pages, gone to.
  func testThePaletteFindsAPage() {
    let app = launch()
    waitForHome(app)
    let search = element(app, "palette-open")
    XCTAssertTrue(search.waitForExistence(timeout: 5), "no Search")
    search.tap()
    let field = element(app, "palette-field")
    XCTAssertTrue(field.waitForExistence(timeout: 5), "the palette didn't open")
    field.typeText("appear")
    let option = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier BEGINSWITH 'palette-' AND label == %@", "Appearance")).firstMatch
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no Appearance in the palette")
    snapshot("palette")
    option.tap()
    waitForTitle(app, "Appearance")
  }

  /// Settings › Data and sync, before the first build.
  func testSettingsData() {
    let app = launch()
    waitForHome(app)
    element(app, "account-menu").tap()
    let settings = button(app, "Accounts and settings")
    XCTAssertTrue(settings.waitForExistence(timeout: 5))
    settings.tap()
    let desk = isDesk(app)
    waitForTitle(app, desk ? "Account" : "Settings")
    let data = element(app, desk ? "nav-settings-data" : "settings-data")
    XCTAssertTrue(data.waitForExistence(timeout: 5))
    data.tap()
    waitForTitle(app, "Data and sync")
    XCTAssertTrue(element(app, "data-sync").exists, "no Build your archive")
    snapshot("settings-data")
  }

  func testTheFrontPageForSomeoneSignedOut() {
    let app = launch(["-VirgaDemoSignedOut", "YES"])
    XCTAssertTrue(element(app, "landing-title").waitForExistence(timeout: 15))
    XCTAssertTrue(element(app, "handle-field").exists)
    XCTAssertTrue(button(app, "Continue as Mira Okafor").exists)
    snapshot("front-page")
  }

  /// A handle typed on the front page: the accounts that match come up
  /// under the field (the demo's two, by handle), and once it is sent, "Is
  /// this you?" with the account found.
  func testSigningInFindsTheHandle() {
    let app = launch(["-VirgaDemoSignedOut", "YES"])
    let field = element(app, "handle-field")
    XCTAssertTrue(field.waitForExistence(timeout: 15))
    field.tap()
    field.typeText("mira")
    let suggestion = element(app, "suggestion-mira.example.com")
    let suggested = suggestion.waitForExistence(timeout: 5)
    snapshot("signin-suggestions")
    XCTAssertTrue(suggested, "no account suggested for “mira”")
    field.typeText(".example.com\n")
    let found = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier == 'signin-continue' AND NOT (label BEGINSWITH %@)", "Looking you up"))
      .firstMatch
    let reached = found.waitForExistence(timeout: 10)
    snapshot("signin-is-this-you")
    XCTAssertTrue(element(app, "signin-title").exists)
    XCTAssertTrue(reached, "the handle wasn't found")
  }

  /// The Terms, from the front page's foot.
  func testTheTermsFromTheFrontPage() {
    let app = launch(["-VirgaDemoSignedOut", "YES"])
    XCTAssertTrue(element(app, "landing-title").waitForExistence(timeout: 15))
    let terms = button(app, "Terms")
    scrollTo(app, terms)
    terms.tap()
    let title = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier == 'legal-title' AND label == %@", "Terms of Service")).firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 10), "no Terms of Service")
    snapshot("terms")
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
    waitForHome(app)
  }
}
