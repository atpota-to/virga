// The new post shortcut (Shell.jsx's useNewPostShortcut), on a hardware
// keyboard: N on a page opens the composer; N in a field on a page is
// typed into it and opens nothing. Tried on the iPad, where a keyboard is
// at home; the phone has the same shell and the same shortcut.
//
// The "@" list's keys (PostEditor.jsx's onKeyDown): on the iPad's
// keyboard ↓ marks the second person and Return takes them, Escape closes
// the list, which stays closed until the mention changes, and Tab takes
// the marked person of the list that comes back; on the phone the software
// keyboard's Return takes the marked person, the first, as Safari's
// keydown Enter does on the web. The typing probe is on (TypingProbe): its
// record of the post's field says how each of the list's keys came in (a
// key command, its press, insertText) and what came of it. It is written
// to the log when a step fails (VIRGA-TYPED-TRACE) and once the keys have
// all been pressed (VIRGA-KEYS-TRACE), so a run that passes says which way
// each key came too.
//
// XCUITest's typeKey is a hardware key: on CI's iPad simulator the
// software keyboard hides as each one arrives and comes back about two
// seconds later. In runs 99 and 100 its ↓ reached the post editor and its
// Return reached it by no route at all (no press, key command or
// insertText in the probe's record), why isn't known. So on the iPad each
// key is tried three ways (the app's typeKey, the field's typeKey, the key
// typed as text), each logged (VIRGA-KEY) with the probe's record after,
// and the test still requires the key to do what the web's does.

import UIKit
import XCTest

final class ShortcutUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  /// The app in demo mode; with `probe`, the typing probe on as well.
  private func launch(probe: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDemoFlags", "latency=0"]
    if probe { app.launchArguments += ["-VirgaTypingProbe", "YES"] }
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

  /// The typing probe's record of one field (TypingProbe.report), or nil,
  /// read as ComposerUITests reads it.
  private func probeRecord(of identifier: String, in app: XCUIApplication) -> [String: Any]? {
    let probe = element(app, "typing-probe")
    guard probe.exists, let json = probe.value as? String, let data = json.data(using: .utf8),
      let all = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    return all[identifier] as? [String: Any]
  }

  private func jsonLine(_ object: Any?) -> String {
    guard let object, JSONSerialization.isValidJSONObject(object),
      let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    else { return "unavailable" }
    return String(decoding: data, as: UTF8.self)
  }

  /// The probe's record of the post's field, written to the log under
  /// `tag` and kept with the results.
  private func trace(_ app: XCUIApplication, _ tag: String) {
    let keyboard = app.keyboards.firstMatch
    let keyboards = "keyboards=\(app.keyboards.count)\(keyboard.exists ? " frame=\(keyboard.frame)" : "")"
    let line = "\(tag) field=post-editor-0 \(keyboards) \(jsonLine(probeRecord(of: "post-editor-0", in: app)))"
    print(line)
    let attachment = XCTAttachment(string: line)
    attachment.name = tag
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  /// Asserts `ok`, writing the probe's record first when it fails.
  private func check(
    _ app: XCUIApplication, _ ok: Bool, _ message: @autoclosure () -> String,
    file: StaticString = #filePath, line: UInt = #line
  ) {
    if !ok { trace(app, "VIRGA-TYPED-TRACE") }
    XCTAssertTrue(ok, message(), file: file, line: line)
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
    let app = launch(probe: true)
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
    check(app, second.waitForExistence(timeout: 10), "fewer than two people offered for “ma”")
    check(app, waitUntil(first, "isSelected == true"), "the first person isn't marked")

    if !isPad {
      // The phone's Return takes the marked person rather than making a new line.
      let picked = handle(of: first)
      field.typeText("\n")
      check(
        app, waitUntil(field, "value CONTAINS %@", "@\(picked) "),
        "Return didn't take @\(picked): \(String(describing: field.value))")
      check(app, !(field.value as? String ?? "").contains("\n"), "Return made a new line")
      snapshot("composer-mention-return")
      trace(app, "VIRGA-KEYS-TRACE")
      return
    }

    // ↓ marks the second person, and Return takes them. XCUITest's typeKey
    // Return never reached the field in runs 99 and 100 (the probe saw
    // no press, key command or insertText for it) while its ↓ did, so each
    // key is tried three ways (the app's typeKey, the field's typeKey, and
    // the key typed as text), each way logged with what came of it, and
    // the probe's record written out after each key: which way, and which
    // route in the field (Q events), took it.
    let value = { field.value as? String ?? "" }
    check(app, pressKey("@ ↓", app, field: field, key: XCUIKeyboardKey.downArrow.rawValue, typed: nil) {
      second.isSelected
    }, "↓ didn't mark the second person, by any way of pressing it")
    snapshot("composer-mention-marked-ipad")
    let picked = handle(of: second)
    let returned = pressKey("@ Return", app, field: field, key: XCUIKeyboardKey.return.rawValue, typed: "\n") {
      value().contains("@\(picked) ") || value().contains("\n")
    }
    trace(app, "VIRGA-KEYS-TRACE after Return")
    check(app, !value().contains("\n"), "Return made a new line")
    check(app, returned, "Return didn't take @\(picked), by any way of pressing it: \(value())")
    let list = element(app, "mention-list")
    check(app, list.waitForNonExistence(timeout: 5), "the list stayed up after the pick")

    // Escape closes the list, not the composer, and the list stays closed
    // until the mention changes.
    field.typeText("and @bo")
    check(app, first.waitForExistence(timeout: 10), "no one offered for “bo”")
    let before = value()
    let escaped = pressKey("@ Escape", app, field: field, key: XCUIKeyboardKey.escape.rawValue, typed: "\u{1b}") {
      // Closed, the post as it was: an escape typed into it as a letter
      // would end the mention without being Escape.
      !list.exists && value() == before
    }
    trace(app, "VIRGA-KEYS-TRACE after Escape")
    check(app, escaped, "Escape didn't close the list, by any way of pressing it: \(value())")
    check(app, element(app, "composer-title").exists, "Escape closed the composer")
    sleep(1)
    check(app, !list.exists, "the list came back for the same mention")
    field.typeText("6")
    check(app, first.waitForExistence(timeout: 10), "the list didn't come back for “bo6”")

    // Tab takes the marked person, the first, and types no tab.
    let tabbed = handle(of: first)
    let tabTook = pressKey("@ Tab", app, field: field, key: XCUIKeyboardKey.tab.rawValue, typed: "\t") {
      value().contains("@\(tabbed) ") || value().contains("\t")
    }
    trace(app, "VIRGA-KEYS-TRACE after Tab")
    check(app, !value().contains("\t"), "Tab typed a tab")
    check(app, tabTook, "Tab didn't take @\(tabbed), by any way of pressing it: \(value())")
    check(app, list.waitForNonExistence(timeout: 5), "the list stayed up after Tab's pick")
  }

  /// Presses `key` each way in turn, the app's typeKey, the field's
  /// typeKey and (with `typed`) the field's typeText, until `done` holds,
  /// giving each way three seconds; logs each way and what came of it
  /// (VIRGA-KEY). True once one way did it.
  private func pressKey(
    _ name: String, _ app: XCUIApplication, field: XCUIElement, key: String, typed: String?, done: () -> Bool
  ) -> Bool {
    var ways: [(String, () -> Void)] = [
      ("app.typeKey", { app.typeKey(key, modifierFlags: []) }),
      ("field.typeKey", { field.typeKey(key, modifierFlags: []) }),
    ]
    if let typed { ways.append(("field.typeText", { field.typeText(typed) })) }
    for (way, act) in ways {
      act()
      let deadline = Date().addingTimeInterval(3)
      repeat {
        if done() {
          print("VIRGA-KEY \(name) via \(way): done (keyboards=\(app.keyboards.count))")
          return true
        }
        Thread.sleep(forTimeInterval: 0.3)
      } while Date() < deadline
      print("VIRGA-KEY \(name) via \(way): nothing (keyboards=\(app.keyboards.count))")
    }
    return false
  }
}
