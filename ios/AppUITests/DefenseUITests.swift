// Defense in demo mode, turned on for the build (`-VirgaDefense on`) and
// granted by the harness (`-VirgaDemoFlags "defense=on"`), once the first
// build has read Mira's whole archive: the page before a scan, a scan of
// one of Mira's posts finished with its radar and its table, the Lists
// page and the History page (whatever state the demo's server lets them
// reach). Each is kept as a screenshot, on the iPhone and the iPad.

import UIKit
import XCTest

final class DefenseUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDefense", "on", "-VirgaDemoFlags", "latency=0&defense=on"]
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

  private func waitForTitle(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let heading = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'page-title' AND label == %@", title)).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "no page titled \(title)", file: file, line: line)
  }

  private func part(_ app: XCUIApplication, _ key: String) -> XCUIElement {
    element(app, isDesk(app) ? "nav-\(key)" : "tab-\(key)")
  }

  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement) {
    var tries = 0
    while !target.isHittable && tries < 8 {
      app.swipeUp()
      tries += 1
    }
  }

  private func buildTheArchive(_ app: XCUIApplication) {
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page")
    element(app, "first-run-build").tap()
    let built = element(app, "first-run-title").waitForNonExistence(timeout: 180)
    XCTAssertFalse(element(app, "first-run-error").exists, "the first build failed")
    XCTAssertTrue(built, "the first build didn't finish in three minutes")
    waitForTitle(app, "Overview")
  }

  /// A Defense page through the command palette, from Defense's front page.
  private func openFromPalette(_ app: XCUIApplication, _ path: String, _ title: String) {
    part(app, "defense").tap()
    waitForTitle(app, "Defense")
    app.swipeDown()
    let search = element(app, "palette-open")
    XCTAssertTrue(search.waitForExistence(timeout: 5), "no Search")
    search.tap()
    let field = element(app, "palette-field")
    XCTAssertTrue(field.waitForExistence(timeout: 5), "the palette didn't open")
    field.typeText(title)
    let option = element(app, "palette-go:\(path)")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no \(title) in the palette")
    option.tap()
    waitForTitle(app, title)
  }

  func testDefenseOnTheBuiltArchive() {
    let app = launch()
    buildTheArchive(app)

    // Before a scan: the form, Mira's posts to scan, how a scan sorts people.
    let defense = part(app, "defense")
    XCTAssertTrue(defense.waitForExistence(timeout: 5), "no Defense in the shell")
    defense.tap()
    waitForTitle(app, "Defense")
    XCTAssertTrue(element(app, "defense-bands").waitForExistence(timeout: 10), "no bands before a scan")
    snapshot("defense-before-scan")

    // A scan of one of Mira's posts.
    let recent = element(app, "defense-scan-recent-0")
    XCTAssertTrue(recent.waitForExistence(timeout: 10), "none of Mira's posts offered to scan")
    recent.tap()
    if element(app, "defense-progress").waitForExistence(timeout: 5) { snapshot("defense-scanning") }
    let result = element(app, "defense-result")
    let finished = result.waitForExistence(timeout: 120)
    if !finished, element(app, "defense-failure").exists { snapshot("defense-scan-failed") }
    XCTAssertTrue(finished, "the scan didn't finish in two minutes")
    snapshot("defense-scan")

    let radar = element(app, "defense-radar")
    if radar.waitForExistence(timeout: 5) {
      scrollTo(app, radar)
      snapshot("defense-radar")
    }
    let table = element(app, "show-as-table")
    scrollTo(app, table)
    if table.exists {
      table.tap()
      if element(app, "defense-table").waitForExistence(timeout: 5) {
        scrollTo(app, element(app, "defense-table"))
        snapshot("defense-scan-table")
      }
    }
    let near = element(app, "defense-near")
    if near.exists {
      scrollTo(app, near)
      snapshot("defense-near")
    }
    let add = element(app, "defense-add")
    if add.exists {
      scrollTo(app, add)
      snapshot("defense-add-to-list")
    }

    // The Lists page and the History page, whatever the demo's server says.
    openFromPalette(app, "/defense/lists", "Lists")
    snapshot("defense-lists")
    openFromPalette(app, "/defense/history", "History")
    _ = app.staticTexts.matching(NSPredicate(format: "label == %@", "Reading the history…")).firstMatch.waitForNonExistence(timeout: 15)
    snapshot("defense-history")
  }
}
