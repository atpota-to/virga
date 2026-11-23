// The tools and Post this chart, in demo mode, once the first build has
// read Mira's whole archive from the demo's network: the Tools page, the
// Identity inspector (its PDS and its handle history read from the made-up
// directory), Best time to post, Follow cleanup before and after its
// activity check, the Interaction lookup with a handle looked up, and a
// dashboard card's picture in the share dialog. Each is kept as a
// screenshot (an XCTAttachment kept always), on the iPhone and the iPad.
//
// One test builds the archive and walks through them all, so the build
// (the slow part) runs once per device.

import UIKit
import XCTest

final class ToolsUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

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

  /// Anything whose words hold `words` (a row read as one says its parts together).
  private func text(_ app: XCUIApplication, containing words: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
  }

  private func waitForTitle(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let heading = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'page-title' AND label == %@", title)).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "no page titled \(title)", file: file, line: line)
  }

  private func part(_ app: XCUIApplication, _ key: String) -> XCUIElement {
    element(app, isDesk(app) ? "nav-\(key)" : "tab-\(key)")
  }

  /// Swipes the page up until `target` can be pressed (a few times at most).
  private func scrollTo(_ app: XCUIApplication, _ target: XCUIElement) {
    var tries = 0
    while !target.isHittable && tries < 8 {
      app.swipeUp()
      tries += 1
    }
  }

  /// The Tools page, then one tool from it.
  private func openTool(_ app: XCUIApplication, _ key: String, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    part(app, "tools").tap()
    waitForTitle(app, "Tools", file: file, line: line)
    let row = element(app, "tool-\(key)")
    XCTAssertTrue(row.waitForExistence(timeout: 5), "no row for \(key)", file: file, line: line)
    scrollTo(app, row)
    row.tap()
    waitForTitle(app, title, file: file, line: line)
  }

  /// The first build, pressed, and waited for (no added latency).
  private func buildTheArchive(_ app: XCUIApplication) {
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page")
    element(app, "first-run-build").tap()
    let built = element(app, "first-run-title").waitForNonExistence(timeout: 180)
    XCTAssertFalse(element(app, "first-run-error").exists, "the first build failed")
    XCTAssertTrue(built, "the first build didn't finish in three minutes")
    waitForTitle(app, "Overview")
  }

  func testTheToolsOnTheBuiltArchive() {
    let app = launch(["-VirgaDemoFlags", "latency=0"])
    buildTheArchive(app)

    // The Tools page, each tool with what it has to say now.
    part(app, "tools").tap()
    waitForTitle(app, "Tools")
    XCTAssertTrue(element(app, "tool-archive").waitForExistence(timeout: 10), "no row for the archive")
    // The rest of the sync (engagement, notifications) runs on after the
    // first build's page has gone, in a strip at the top of a phone's page:
    // the page once it ends. Its Cancel, not the strip, which stays to say a
    // sync had problems.
    _ = element(app, "sync-cancel").waitForNonExistence(timeout: 60)
    snapshot("tools-built")

    // Identity: the PDS and the handle history, from the demo's directory.
    openTool(app, "identity", "Identity inspector")
    _ = text(app, containing: "Looking it up…").waitForNonExistence(timeout: 15)
    _ = text(app, containing: "Reading the log…").waitForNonExistence(timeout: 15)
    XCTAssertTrue(text(app, containing: "Created").waitForExistence(timeout: 10), "no handle history")
    snapshot("tool-identity")

    // Best time to post.
    openTool(app, "best-time", "Best time to post")
    XCTAssertTrue(element(app, "best-time-statement").waitForExistence(timeout: 10), "no sentence of what the page found")
    snapshot("tool-best-time")

    // Follow cleanup, then its activity check.
    openTool(app, "follow-cleanup", "Follow cleanup")
    snapshot("tool-follow-cleanup")
    let check = element(app, "cleanup-run-check")
    if check.waitForExistence(timeout: 5) {
      check.tap()
      let checked = text(app, containing: "Activity checked for").waitForExistence(timeout: 90)
      XCTAssertTrue(checked, "the activity check didn't finish")
      // Its toast ("Checked 79 accounts.") comes a beat after the line, and
      // fades in.
      if text(app, containing: "Checked ").waitForExistence(timeout: 5) { sleep(1) }
      snapshot("tool-follow-cleanup-checked")
    }

    // The Interaction lookup: the people you interact with most, then a
    // handle typed and looked up.
    openTool(app, "interaction-lookup", "Interaction lookup")
    XCTAssertTrue(element(app, "lookup-start").waitForExistence(timeout: 10), "no starting point")
    snapshot("tool-interaction-lookup")
    let field = element(app, "lookup-field")
    XCTAssertTrue(field.waitForExistence(timeout: 5), "no search field")
    field.tap()
    field.typeText("bo.example.com")
    let option = element(app, "lookup-option-0")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "nothing offered for bo.example.com")
    snapshot("tool-interaction-lookup-search")
    option.tap()
    XCTAssertTrue(element(app, "lookup-name").waitForExistence(timeout: 15), "no history with the account looked up")
    snapshot("tool-interaction-lookup-chosen")
    let totals = element(app, "lookup-totals")
    if totals.waitForExistence(timeout: 5) {
      scrollTo(app, totals)
      snapshot("tool-interaction-lookup-totals")
    }

    // Post this chart, from a dashboard card.
    part(app, "dashboard").tap()
    waitForTitle(app, "Overview")
    let post = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'post-chart-'")).firstMatch
    XCTAssertTrue(post.waitForExistence(timeout: 10), "no Post this chart on a card")
    scrollTo(app, post)
    post.tap()
    XCTAssertTrue(element(app, "share-dialog").waitForExistence(timeout: 10), "the share dialog didn't open")
    XCTAssertTrue(element(app, "share-picture").waitForExistence(timeout: 20), "the picture wasn't drawn")
    snapshot("share-dialog")
    element(app, "dialog-close").tap()
  }
}
