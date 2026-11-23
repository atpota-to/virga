// Posting › Templates and Settings › Posting in demo mode. Neither waits
// for the archive, so no build: from the first build's page, the command
// palette goes to Templates (Mira's two, read from her repo), the editor
// opens on Event reminder, which asks two questions, its Use opens the
// composer on it (the questions in the library's dialog), and then
// Settings › Posting, from its top to the default timer and back up to its
// language field with a few letters typed, its suggestions clear of the
// keyboard, and the first one pressed (on the iPad then the keyboard's
// Escape, and ↓ and Return). Each is kept as a screenshot, on the iPhone
// and the iPad.

import UIKit
import XCTest

final class PostingUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

  /// The app in demo mode. On the iPad, whose language steps press
  /// hardware keys, the typing probe is on too, so the language search
  /// records which way each key reached it (TypingProbe).
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += ["-VirgaDemo", "YES", "-VirgaDemoFlags", "latency=0"]
    if isPad { app.launchArguments += ["-VirgaTypingProbe", "YES"] }
    app.launch()
    return app
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

  /// A page through the command palette: Search, a few letters, its option.
  private func go(_ app: XCUIApplication, _ path: String, typing: String, title: String) {
    // A button, not the navigation bar's group of toolbar items, which on iOS 26
    // takes the first item's identifier and whose middle is the account button.
    let search = app.buttons.matching(identifier: "palette-open").firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 10), "no Search")
    // On a part's front page the phone's app bar is in the page and scrolls
    // away with it (as `.appbar` on the web): back to the top for Search,
    // until a swipe no longer moves it. Stopping as soon as it showed left
    // it 51 points short of the top in run 85, under the iPhone's status
    // bar, where both taps missed it.
    var swipes = 0
    var top = search.frame.minY
    repeat {
      app.swipeDown()
      swipes += 1
      let moved = search.frame.minY != top
      top = search.frame.minY
      if !moved, search.isHittable { break }
    } while swipes < 8
    // Straight after a sheet closes (the template editor), Search is in the
    // hierarchy before it can be pressed, and a tap in the closing animation
    // is dropped: wait until it can be, and press once more if the palette
    // still isn't there.
    let pressable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: search)
    wait(for: [pressable], timeout: 10)
    search.tap()
    let field = element(app, "palette-field")
    if !field.waitForExistence(timeout: 3), search.isHittable { search.tap() }
    XCTAssertTrue(field.waitForExistence(timeout: 5), "the palette didn't open")
    field.typeText(typing)
    let option = element(app, "palette-go:\(path)")
    XCTAssertTrue(option.waitForExistence(timeout: 5), "no \(title) in the palette")
    option.tap()
    waitForTitle(app, title)
  }

  func testTemplatesAndPostingSettings() {
    let app = launch()
    XCTAssertTrue(element(app, "first-run-title").waitForExistence(timeout: 15), "no first build's page")

    // Templates: Mira's, read from her repo.
    go(app, "/posting/templates", typing: "Templates", title: "Templates")
    XCTAssertTrue(element(app, "templates-list").waitForExistence(timeout: 15), "no templates listed")
    snapshot("posting-templates")

    // The editor, on the template that asks two questions.
    let name = app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier BEGINSWITH 'template-name-' AND label == %@", "Event reminder")).firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 5), "no Event reminder")
    name.tap()
    XCTAssertTrue(element(app, "template-editor").waitForExistence(timeout: 5), "the editor didn't open")
    snapshot("template-editor")
    let questions = element(app, "template-questions-editor")
    XCTAssertTrue(questions.waitForExistence(timeout: 5), "the editor shows no questions")
    var tries = 0
    while !questions.isHittable && tries < 4 {
      app.swipeUp()
      tries += 1
    }
    snapshot("template-editor-questions")
    element(app, "dialog-close").tap()
    XCTAssertTrue(element(app, "template-editor").waitForNonExistence(timeout: 5), "the editor stayed open")

    // Use: the composer opens with the template applied; this one asks its
    // two questions, in the library's dialog on it.
    // Straight after the editor's sheet closes, as in go(): wait until Use
    // can be pressed, and press once more if the composer isn't coming.
    let use = app.buttons["Use “Event reminder”"].firstMatch
    XCTAssertTrue(use.waitForExistence(timeout: 5), "no Use for Event reminder")
    let usable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: use)
    wait(for: [usable], timeout: 10)
    use.tap()
    let composerTitle = element(app, "composer-title")
    if !composerTitle.waitForExistence(timeout: 3), use.isHittable { use.tap() }
    XCTAssertTrue(composerTitle.waitForExistence(timeout: 10), "Use didn't open the composer")
    XCTAssertTrue(element(app, "template-question-0").waitForExistence(timeout: 15), "Use didn't apply the template")
    snapshot("posting-template-use")
    // The library's dialog closes from its head's Close, the kit's dialog
    // head (Dialog.jsx's), as in ComposerUITests.
    element(app, "dialog-close").tap()
    XCTAssertTrue(element(app, "library-panel").waitForNonExistence(timeout: 5), "the library stayed open")
    element(app, "composer-close").tap()
    XCTAssertTrue(element(app, "composer-title").waitForNonExistence(timeout: 5), "the composer stayed open")

    // Settings › Posting, from the top to the default timer.
    go(app, "/settings/posting", typing: "Posting", title: "Posting")
    XCTAssertTrue(element(app, "posting-new-posts").waitForExistence(timeout: 10), "no New posts")
    snapshot("settings-posting")
    let timer = element(app, "posting-default-timer")
    tries = 0
    while !(timer.exists && timer.isHittable) && tries < 6 {
      app.swipeUp()
      tries += 1
    }
    snapshot("settings-posting-timer")

    // Back at the top, its language field with "fr" typed: the suggestions
    // float over the rows under it. On the iPhone the field is low in the
    // window, and the page brings the list into view over the keyboard by
    // itself. Reaching the field is guarded; once it has the keyboard, the
    // list must clear the keyboard and a press on its first suggestion,
    // outside the field's frame, must add that language.
    let languages = app.textFields["Languages"].firstMatch
    guard languages.waitForExistence(timeout: 5) else { return }
    var top = languages.frame.minY
    tries = 0
    repeat {
      app.swipeDown()
      tries += 1
      let moved = languages.frame.minY != top
      top = languages.frame.minY
      if !moved { break }
    } while tries < 8
    guard languages.isHittable else { return }
    let removes = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Remove '"))
    var chosen = labels(removes)
    languages.tap()
    let keyboard = app.keyboards.firstMatch
    guard keyboard.waitForExistence(timeout: 3) else { return }
    languages.typeText("fr")
    let suggestions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'language-'"))
    XCTAssertTrue(suggestions.firstMatch.waitForExistence(timeout: 5), "no language suggestions for “fr”")
    // The list is brought up once the keyboard is: wait until its last row
    // is over the keyboard (or the keyboard has gone, as with a hardware one).
    let covered: () -> Bool = {
      let lowest = suggestions.allElementsBoundByIndex.map { $0.frame.maxY }.max()
      guard keyboard.exists, let lowest else { return false }
      return lowest > keyboard.frame.minY + 0.5
    }
    tries = 0
    while covered() && tries < 12 {
      Thread.sleep(forTimeInterval: 0.5)
      tries += 1
    }
    snapshot("settings-posting-languages")
    XCTAssertFalse(covered(), "the language suggestions stayed under the keyboard")
    // The first suggestion, by its place on screen.
    guard let first = suggestions.allElementsBoundByIndex.min(by: { $0.frame.minY < $1.frame.minY }) else { return }
    let firstLabel = first.label
    first.tap()
    XCTAssertTrue(
      newToken(removes, besides: chosen).map { firstLabel.hasPrefix($0) } ?? false,
      "a press on “\(firstLabel)” didn't add it")

    // On the iPad, a hardware keyboard's: with the list open again, Escape
    // puts it away, and ↓ then Return adds the second suggestion. (Mira
    // starts with English, so this is the third language, the most there
    // can be: Escape goes first.) The field is a KeyTextField, still
    // app.textFields["Languages"]: these keys reach the picker by its
    // pressesBegan, its priority key commands or, for Return, its delegate.
    // In runs 99, 100 and 103 XCUITest's typeKey Escape never closed the
    // list, with the software keyboard up or none at all, so each key is
    // tried three ways (the app's typeKey, the field's typeKey, and the
    // key typed as text), each way logged with what came of it, and the
    // typing probe's record of the field (key-field: P a press by its key
    // code, Q a key by the way it came and what came of it, C the key
    // commands offered) is written out after.
    guard isPad else { return }
    languages.tap()
    languages.typeText("e")
    guard suggestions.firstMatch.waitForExistence(timeout: 5) else {
      return XCTFail("no language suggestions for “e”")
    }
    let escaped = pressKey(
      "language Escape", app, field: languages, key: XCUIKeyboardKey.escape.rawValue, typed: "\u{1b}"
    ) {
      // Closed, with the query still "e": an escape typed into it as a
      // letter would empty the list without being Escape.
      !suggestions.firstMatch.exists && (languages.value as? String) == "e"
    }
    trace(app, "VIRGA-KEYS-TRACE after Escape")
    guard escaped else { return XCTFail("Escape didn't put the language suggestions away, by any way of pressing it") }
    chosen = labels(removes)
    // The "e" taken out: the empty query's six suggestions, the list open again.
    let emptied = pressKey(
      "language Delete", app, field: languages, key: XCUIKeyboardKey.delete.rawValue, typed: XCUIKeyboardKey.delete.rawValue
    ) { suggestions.firstMatch.exists }
    guard emptied else {
      return XCTFail("the language suggestions didn't come back as the query emptied")
    }
    let rows = suggestions.allElementsBoundByIndex.sorted { $0.frame.minY < $1.frame.minY }
    guard rows.count >= 2 else {
      return XCTFail("fewer than two language suggestions for an empty query: \(rows.count)")
    }
    let secondLabel = rows[1].label
    let secondID = rows[1].identifier
    let marked = pressKey("language ↓", app, field: languages, key: XCUIKeyboardKey.downArrow.rawValue, typed: nil) {
      app.buttons[secondID].isSelected
    }
    XCTAssertTrue(marked, "↓ didn't highlight the second suggestion, by any way of pressing it")
    var added: String?
    let returned = pressKey("language Return", app, field: languages, key: XCUIKeyboardKey.return.rawValue, typed: "\n") {
      added = self.newToken(removes, besides: chosen, tries: 1)
      return added != nil
    }
    trace(app, "VIRGA-KEYS-TRACE after Return")
    XCTAssertTrue(returned, "Return didn't add a language, by any way of pressing it")
    XCTAssertTrue(
      added.map { secondLabel.hasPrefix($0) } ?? false,
      "↓ and Return didn't add the second suggestion, “\(secondLabel)”: \(added ?? "nothing")")
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

  /// The typing probe's record of the language search (TypingProbe's
  /// "typing-probe" element, on the Settings page while the probe is on),
  /// written to the log and kept with the results.
  private func trace(_ app: XCUIApplication, _ tag: String) {
    let probe = app.descendants(matching: .any).matching(identifier: "typing-probe").firstMatch
    var record = "unavailable"
    if probe.exists, let json = probe.value as? String, let data = json.data(using: .utf8),
      let all = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let field = all["key-field"],
      JSONSerialization.isValidJSONObject(field),
      let line = try? JSONSerialization.data(withJSONObject: field, options: [.sortedKeys])
    {
      record = String(decoding: line, as: UTF8.self)
    }
    let text = "\(tag) field=key-field keyboards=\(app.keyboards.count) \(record)"
    print(text)
    let attachment = XCTAttachment(string: text)
    attachment.name = tag
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func labels(_ query: XCUIElementQuery) -> Set<String> {
    Set(query.allElementsBoundByIndex.map { $0.label })
  }

  /// The language a new token names, once one of `removes` (the tokens'
  /// "Remove <name>" buttons) has a label not in `besides`; nil if none
  /// comes within five seconds.
  private func newToken(_ removes: XCUIElementQuery, besides: Set<String>, tries: Int = 10) -> String? {
    for _ in 0..<tries {
      if let label = labels(removes).first(where: { !besides.contains($0) }) {
        return String(label.dropFirst("Remove ".count))
      }
      Thread.sleep(forTimeInterval: 0.5)
    }
    return nil
  }
}
