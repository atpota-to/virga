// Defense in demo mode, turned on for the build (`-VirgaDefense on`, and
// its moderator with `-VirgaDefenseModerator on`) and granted by the
// harness with the lists' permission (`-VirgaDemoFlags "defense=lists"`),
// the demo server's workers running every two seconds (`cron=2`), once the
// first build has read Mira's whole archive: the page before a scan, a
// scan of one of Mira's posts finished with its radar and its table, Add
// to a list through to done (a new list made from the scan), the Lists
// page with that list and the moderator's link code (and the link once it
// lands), and the History page after the worker has written the adds, then
// with an approval undone. Each is kept as a screenshot, on the iPhone and
// the iPad.

import UIKit
import XCTest

final class DefenseUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += [
      "-VirgaDemo", "YES", "-VirgaDefense", "on", "-VirgaDefenseModerator", "on", "-VirgaDemoFlags", "latency=0&defense=lists&cron=2",
    ]
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

  /// Swipes the page up until all of `target` is on the screen, clear of its
  /// bottom edge, for a field about to be typed in: a field counts as
  /// hittable with a sliver of it showing, and a tap on that sliver at the
  /// iPad's bottom edge doesn't focus it (as VirgaUITests' chart note).
  private func scrollWhollyInto(_ app: XCUIApplication, _ target: XCUIElement) {
    let bottom = app.windows.firstMatch.frame.maxY - 120
    var tries = 0
    while (!target.isHittable || target.frame.maxY > bottom) && tries < 8 {
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
    // A button, not the navigation bar's group of toolbar items, which on iOS 26
    // takes the first item's identifier and whose middle is the account button.
    let search = app.buttons.matching(identifier: "palette-open").firstMatch
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
    XCTAssertTrue(add.waitForExistence(timeout: 10), "no Add to a list under the scan")
    scrollTo(app, add)
    snapshot("defense-add-to-list")
    let added = addToANewList(app)

    // The Lists page: the list the scan made (written by the worker by
    // now), and the moderator's link code, then the link once it lands.
    openFromPalette(app, "/defense/lists", "Lists")
    if added { XCTAssertTrue(element(app, "defense-list-row").waitForExistence(timeout: 15), "the list made from the scan isn't on Lists") }
    snapshot("defense-lists")
    linkTheModerator(app)

    // History: the approval and everyone on it, once the worker has run;
    // then the approval undone.
    openFromPalette(app, "/defense/history", "History")
    _ = app.staticTexts.matching(NSPredicate(format: "label == %@", "Reading the history…")).firstMatch.waitForNonExistence(timeout: 15)
    snapshot("defense-history")
    let undo = element(app, "defense-plan-undo")
    if added, undo.waitForExistence(timeout: 10) {
      undo.tap()
      let confirm = element(app, "defense-undo-confirm")
      XCTAssertTrue(confirm.waitForExistence(timeout: 5), "no Take off in the undo dialog")
      snapshot("defense-history-undo")
      confirm.tap()
      XCTAssertTrue(confirm.waitForNonExistence(timeout: 15), "the undo dialog stayed")
      // The removes are written by the next run, and the page reads the
      // history again every fifteen seconds while anything waits.
      let undone = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "undone")).firstMatch
      _ = undone.waitForExistence(timeout: 40)
      snapshot("defense-history-undone")
    }
  }

  /// Add to a list, under the scan: a new list named Pile-ons, with the
  /// bands ticked that have anyone in them if Unknown has nobody, through
  /// the confirm dialog to the done line. Whether anything was added.
  private func addToANewList(_ app: XCUIApplication) -> Bool {
    // No form when the scan can't add anyone (its why is in the last screenshot).
    let go = element(app, "defense-add-go")
    guard go.waitForExistence(timeout: 5) else { return false }
    for band in ["NOTABLE", "PERIPHERAL", "CONNECTED"] where !go.isEnabled || go.label == "Nobody ticked" {
      let tick = element(app, "defense-tick-\(band)")
      if tick.exists && tick.isEnabled {
        scrollTo(app, tick)
        tick.tap()
      }
    }
    let name = element(app, "defense-list-name")
    if name.exists {
      scrollWhollyInto(app, name)
      name.tap()
      name.typeText("Pile-ons")
    }
    scrollTo(app, go)
    guard go.isEnabled else { return false }
    go.tap()
    let confirm = element(app, "defense-add-confirm")
    XCTAssertTrue(confirm.waitForExistence(timeout: 5), "no confirm dialog for the adds")
    snapshot("defense-add-confirm")
    confirm.tap()
    let done = element(app, "defense-done")
    XCTAssertTrue(done.waitForExistence(timeout: 15), "the adds weren't approved")
    scrollTo(app, done)
    snapshot("defense-add-done")
    // Two runs of the worker, so the list holds them before Lists is read.
    Thread.sleep(forTimeInterval: 5)
    return true
  }

  /// The moderator's card on Lists: Link the moderator, its code (which
  /// lands ten seconds later in the demo), then the link.
  private func linkTheModerator(_ app: XCUIApplication) {
    let link = element(app, "defense-moderator-link")
    guard link.waitForExistence(timeout: 10) else { return }
    scrollTo(app, link)
    link.tap()
    let code = element(app, "defense-moderator-code")
    XCTAssertTrue(code.waitForExistence(timeout: 5), "no link code")
    scrollTo(app, code)
    snapshot("defense-moderator-code")
    if element(app, "defense-moderator-linked").waitForExistence(timeout: 30) {
      snapshot("defense-moderator-linked")
    }
  }
}
