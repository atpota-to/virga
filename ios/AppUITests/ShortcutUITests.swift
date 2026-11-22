// The new post shortcut (Shell.jsx's useNewPostShortcut), on a hardware
// keyboard: N on a page opens the composer; N in a field on a page is
// typed into it and opens nothing. Tried on the iPad, where a keyboard is
// at home; the phone has the same shell and the same shortcut.

import UIKit
import XCTest

final class ShortcutUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDemoFlags", "latency=0"]
    app.launch()
    return app
  }

  private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func snapshot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testNOpensANewPostOutsideAField() throws {
    try XCTSkipUnless(isPad, "a hardware keyboard's shortcut, tried on the iPad")
    let app = launch()
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 30), "no first build's page")

    // N on the page: the composer, empty.
    app.typeKey("n", modifierFlags: [])
    XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 10), "N didn't open the composer")
    snapshot("shortcut-new-post-ipad")
    element(app, "composer-close").tap()
    XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 5), "the composer stayed open")

    // N in a field on a page (the Library's search): typed, and nothing opens.
    let search = app.buttons.matching(identifier: "palette-open").firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 10), "no Search")
    search.tap()
    let paletteField = element(app, "palette-field")
    XCTAssertTrue(paletteField.waitForExistence(timeout: 5), "the palette didn't open")
    paletteField.typeText("Library")
    let option = element(app, "palette-go:/posting/library")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no Library in the palette")
    option.tap()
    let field = element(app, "library-search")
    XCTAssertTrue(field.waitForExistence(timeout: 15), "no search on the Library page")
    field.tap()
    app.typeKey("n", modifierFlags: [])
    app.typeKey("n", modifierFlags: [])
    // Either case: the field capitalizes its first letter ("Nn", run 74).
    XCTAssertTrue(
      (field.value as? String)?.lowercased().hasPrefix("nn") == true,
      "N wasn't typed into the field: \(String(describing: field.value))")
    XCTAssertFalse(element(app, "composer-title").exists, "N in a field opened the composer")
    snapshot("shortcut-typed-in-a-field-ipad")
  }
}
