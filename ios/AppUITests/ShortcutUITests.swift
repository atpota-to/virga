// The new post shortcut (Shell.jsx's useNewPostShortcut), on a hardware
// keyboard: N on a page opens the composer; N in a field on a page is
// typed into it and opens nothing. Tried on the iPad, where a keyboard is
// at home; the phone has the same shell and the same shortcut.
//
// The "@" list's keys (PostEditor.jsx's onKeyDown): on the iPad's
// keyboard ↓ marks the second person and Return takes them, and Escape
// closes the list, which stays closed until the mention changes; on the
// phone the software keyboard's Return takes the marked person, the first,
// as Safari's keydown Enter does on the web.

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

  /// Waits until `element` matches `format` (with `arguments`).
  private func waitUntil(_ element: XCUIElement, _ format: String, _ arguments: Any..., timeout: TimeInterval = 5) -> Bool {
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format, argumentArray: arguments), object: element)
    return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
  }

  /// The handle a row of the "@" list offers ("Name, @handle").
  private func handle(of row: XCUIElement) -> String {
    row.label.components(separatedBy: ", @").last ?? ""
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
    // The letters are a search, which asks Bluesky a moment after the typing
    // stops (400 ms): past that, then until what it found (or that nothing
    // matches) is in place of its skeleton, and Searching Bluesky… is gone.
    sleep(1)
    _ = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier == 'library-list' OR identifier == 'library-empty'")).firstMatch
      .waitForExistence(timeout: 5)
    _ = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Searching Bluesky…")).firstMatch
      .waitForNonExistence(timeout: 5)
    snapshot("shortcut-typed-in-a-field-ipad")
  }

  func testTheMentionListTakesItsKeys() {
    let app = launch()
    let wide = isPad && app.windows.firstMatch.frame.width >= 900
    let newPost = element(app, wide ? "sidebar-new-post" : "tab-new-post")
    XCTAssertTrue(newPost.waitForExistence(timeout: 30), "no New post button")
    newPost.tap()
    XCTAssertTrue(element(app, "composer-title").waitForExistence(timeout: 15), "the composer didn't open")
    let field = app.textViews.matching(identifier: "post-editor-0").firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5), "no post editor")
    field.tap()

    // "@ma": the demo's people whose handles start so, the first marked.
    field.typeText("Thanks @ma")
    let first = element(app, "mention-option-0")
    let second = element(app, "mention-option-1")
    XCTAssertTrue(second.waitForExistence(timeout: 10), "fewer than two people offered for “ma”")
    XCTAssertTrue(waitUntil(first, "isSelected == true"), "the first person isn't marked")

    if !isPad {
      // The phone's Return takes the marked person rather than making a new line.
      let picked = handle(of: first)
      field.typeText("\n")
      XCTAssertTrue(
        waitUntil(field, "value CONTAINS %@", "@\(picked) "),
        "Return didn't take @\(picked): \(String(describing: field.value))")
      XCTAssertFalse((field.value as? String ?? "").contains("\n"), "Return made a new line")
      snapshot("composer-mention-return")
      return
    }

    // ↓ marks the second person, and Return takes them.
    app.typeKey(XCUIKeyboardKey.downArrow.rawValue, modifierFlags: [])
    XCTAssertTrue(waitUntil(second, "isSelected == true"), "↓ didn't mark the second person")
    snapshot("composer-mention-marked-ipad")
    let picked = handle(of: second)
    app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
    XCTAssertTrue(
      waitUntil(field, "value CONTAINS %@", "@\(picked) "),
      "Return didn't take @\(picked): \(String(describing: field.value))")
    XCTAssertFalse((field.value as? String ?? "").contains("\n"), "Return made a new line")
    let list = element(app, "mention-list")
    XCTAssertTrue(list.waitForNonExistence(timeout: 5), "the list stayed up after the pick")

    // Escape closes the list, not the composer, and the list stays closed
    // until the mention changes.
    field.typeText("and @bo")
    XCTAssertTrue(first.waitForExistence(timeout: 10), "no one offered for “bo”")
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    XCTAssertTrue(list.waitForNonExistence(timeout: 5), "Escape didn't close the list")
    XCTAssertTrue(element(app, "composer-title").exists, "Escape closed the composer")
    sleep(1)
    XCTAssertFalse(list.exists, "the list came back for the same mention")
    field.typeText("6")
    XCTAssertTrue(first.waitForExistence(timeout: 10), "the list didn't come back for “bo6”")
  }
}
